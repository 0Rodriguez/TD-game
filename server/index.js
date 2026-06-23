/**
 * Doodle Defense — Leaderboard API
 *
 * Endpoints:
 *   GET  /api/leaderboard            -> top 20 by score, descending
 *   POST /api/leaderboard            -> { nickname, score }
 *                                       Inserts new nickname OR replaces only
 *                                       if the new score beats the existing one.
 *   GET  /api/health                 -> liveness probe
 *
 * Storage is a plain JSON file under ./data/leaderboard.json so the file
 * (and therefore the entire scoreboard) survives container restarts when
 * the `data` directory is bind-mounted to a Docker volume.
 */

import express from 'express';
import cors    from 'cors';
import fs      from 'node:fs/promises';
import path    from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'leaderboard.json');

const PORT      = parseInt(process.env.PORT, 10) || 3000;
const TOP_N     = 20;
const MAX_NICK  = 14;       // max chars of nickname
const MAX_SCORE = 1_000_000_000;

// ---- Storage layer --------------------------------------------------------

/**
 * Ensures the data directory and JSON file exist before any read/write.
 * Idempotent: safe to run on every boot.
 */
async function ensureStorage() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, '[]', 'utf-8');
  }
}

async function readScores() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf-8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    // Corrupted or missing -> start fresh.  We DO NOT throw because a
    // malformed file shouldn't break the API for everyone.
    console.error('[leaderboard] read error, resetting:', err.message);
    await fs.writeFile(DATA_FILE, '[]', 'utf-8');
    return [];
  }
}

async function writeScores(scores) {
  // Write atomically: write to .tmp then rename -> avoids corruption if the
  // container is killed mid-write.
  const tmp = DATA_FILE + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(scores, null, 2), 'utf-8');
  await fs.rename(tmp, DATA_FILE);
}

// ---- Validation helpers ---------------------------------------------------

// Strips C0 control chars (U+0000-U+001F) and DEL (U+007F).  Built from char
// codes so no tool/editor can mangle the literal control-char ranges.
const CONTROL_CHARS = new RegExp(
  '[' + String.fromCharCode(0) + '-' + String.fromCharCode(0x1f)
      + String.fromCharCode(0x7f) + ']',
  'g'
);

/**
 * Normalises a raw nickname: strips control chars, trims, collapses internal
 * whitespace, clips to MAX_NICK chars.  Returns null if the cleaned value
 * is empty.
 */
function normaliseNickname(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .replace(CONTROL_CHARS, '')
    .trim()
    .replace(/\s+/g, ' ');
  if (cleaned.length === 0) return null;
  return cleaned.slice(0, MAX_NICK);
}

function isValidScore(n) {
  return typeof n === 'number'
      && Number.isFinite(n)
      && n >= 0
      && n <= MAX_SCORE
      && Number.isInteger(n);
}

// ---- Express app ----------------------------------------------------------

const app = express();
app.use(cors());                          // open for the game frontend
app.use(express.json({ limit: '1kb' }));  // tiny payloads only

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.get('/api/leaderboard', async (_req, res) => {
  try {
    const all = await readScores();
    const top = [...all]
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_N);
    res.json(top);
  } catch (err) {
    console.error('[leaderboard][GET]', err);
    res.status(500).json({ error: 'storage_error' });
  }
});

app.post('/api/leaderboard', async (req, res) => {
  const nickname = normaliseNickname(req.body?.nickname);
  const score    = req.body?.score;

  if (!nickname)            return res.status(400).json({ error: 'invalid_nickname' });
  if (!isValidScore(score)) return res.status(400).json({ error: 'invalid_score' });

  try {
    const scores = await readScores();

    // Case-insensitive uniqueness — "PEPE" and "pepe" are the same player.
    const key   = nickname.toLowerCase();
    const idx   = scores.findIndex(s => s.nickname.toLowerCase() === key);
    const now   = Date.now();
    let action  = 'no_change';

    if (idx === -1) {
      scores.push({ nickname, score, updatedAt: now });
      action = 'created';
    } else if (score > scores[idx].score) {
      // Beat own record — use the latest-typed casing so the player can rename.
      scores[idx] = { nickname, score, updatedAt: now };
      action = 'updated';
    }

    if (action !== 'no_change') {
      await writeScores(scores);
    }

    const top = [...scores]
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_N);

    const rank = top.findIndex(s => s.nickname.toLowerCase() === key);

    res.json({
      action,
      rank: rank === -1 ? null : rank + 1, // 1-indexed; null if outside top-N
      top,
    });
  } catch (err) {
    console.error('[leaderboard][POST]', err);
    res.status(500).json({ error: 'storage_error' });
  }
});

// ---- Boot -----------------------------------------------------------------

await ensureStorage();

app.listen(PORT, () => {
  console.log(`[leaderboard] listening on :${PORT}  ·  file=${DATA_FILE}`);
});
