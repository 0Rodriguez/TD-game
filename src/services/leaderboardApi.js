/**
 * Thin client for the Doodle Defense leaderboard API.
 *
 * URL resolution:
 *   - Production:  uses the relative path `/api/leaderboard`.  The frontend's
 *                  Nginx config proxies `/api/` to the backend container, so
 *                  the browser only ever talks to the public origin.
 *   - Vite dev:    `vite.config.js` proxies `/api` to http://localhost:3000.
 *   - Override:    set `VITE_API_BASE_URL` (e.g. https://api.example.com) at
 *                  build time to point at a remote backend.
 */

const API_BASE  = import.meta.env.VITE_API_BASE_URL || '';
const ENDPOINT  = `${API_BASE}/api/leaderboard`;
const TIMEOUT   = 4000; // ms — fail fast so menu screens don't hang on a dead backend

/**
 * Wraps fetch with a hard timeout via AbortController.
 */
async function fetchWithTimeout(url, opts = {}) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET /api/leaderboard → array of { nickname, score, updatedAt }, top 20 desc.
 * Returns [] on any failure so callers can render an "offline" state cleanly.
 */
export async function fetchLeaderboard() {
  try {
    const res = await fetchWithTimeout(ENDPOINT);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arr = await res.json();
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    console.warn('[leaderboard] fetch failed:', err.message);
    return [];
  }
}

/**
 * POST /api/leaderboard with { nickname, score }.
 * Resolves to { ok: true, action, rank, top } on success,
 *            or { ok: false, error } on failure.
 */
export async function submitScore(nickname, score) {
  try {
    const res = await fetchWithTimeout(ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ nickname, score }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ok: true, ...data };
  } catch (err) {
    return { ok: false, error: err.message || 'network_error' };
  }
}

/**
 * Convenience: returns true if `score` would land in the current top N.
 * Conservative: if the API is unreachable we return true so the player still
 * gets a chance to submit (their POST will then either land or be a no-op).
 */
export async function isTopScore(score, topN = 20) {
  const board = await fetchLeaderboard();
  if (board.length < topN) return true;
  const lowest = board[board.length - 1]?.score ?? 0;
  return score > lowest;
}
