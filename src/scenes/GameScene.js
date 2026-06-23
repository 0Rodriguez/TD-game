import Phaser from 'phaser';
import WaveManager  from '../managers/WaveManager.js';
import TowerManager from '../managers/TowerManager.js';
import { isTopScore, submitScore } from '../services/leaderboardApi.js';

const CELL_SIZE       = 40;
const GRID_COLS       = 20;
const GRID_ROWS       = 15;
const PATH_HALF_WIDTH = 17;   // half-width for grid blocking — strict: only cells whose center is INSIDE the path body are blocked

// UI layout constants
const BTN_H   = 52;           // button height
const BTN_Y   = 527;          // dock top y — also the placement-zone cutoff
const TW_W    = 118;          // tower-button width
const WAVE_W  = 190;          // wave-button width (shrunk to make room for speed btn)
const SPEED_W = 50;           // speed-toggle button width (square-ish)
const FONT    = '"Georgia", "Palatino Linotype", serif';

/**
 * Campaign level definitions.
 * waypoints: [[x,y], ...] — connected with straight lines (orthogonal, ruler style).
 * First point is the enemy spawn; last is the exit edge.
 */
const LEVELS = [
  {
    maxWaves:    3,
    baseEnemyHP: 50,
    waypoints: [
      [0,   200],
      [240, 200],
      [240, 380],
      [560, 380],
      [560, 120],
      [800, 120],
    ],
  },
  {
    maxWaves:    5,
    baseEnemyHP: 80,
    waypoints: [
      [0,   100],
      [160, 100],
      [160, 420],
      [360, 420],
      [360, 180],
      [580, 180],
      [580, 440],
      [800, 440],
    ],
  },
];

export default class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene' });
  }

  init() {
    this.gold      = 500;
    this.score     = 0;
    this.lives     = 20;
    this._gameOver = false;

    this.currentLevel         = 1;
    this._levelTransitioning   = false;
    this._leaderboardPromptOn  = false;
    this._leaderboardSubmitted = false; // spam-lock: flips true after a successful POST

    // Game-speed toggle (1x default, 2x fast-forward).  Applied across
    // time/tweens/physics so wave-spawn delays, enemy path traversal, and
    // projectile flights all scale together.
    this.gameSpeed = 1;
    this._speedBtn = null;

    this.grid           = [];
    this.path           = null;
    this.pathGraphics   = null;
    this.cursorGraphics = null;

    this.waveManager    = null;
    this.towerManager   = null;
    this.currentWave    = 0;

    this._dustEmitter   = null;
    this._hudText       = null;
    this._towerBtns     = null; // { BASIC: Container, INK: Container }
    this._waveBtn       = null;

    this.selectedTowerType  = 'BASIC';
    this._uiIntercepted     = false;

    // Persist high score across sessions via localStorage.
    // Read every init() so a scene.restart() keeps the record intact.
    this.highScore = parseInt(localStorage.getItem('doodle_high_score')) || 0;
  }

  preload() {}

  create() {
    this._generateEnemyTexture();
    this._generateScribbleTexture();
    this._initGrid();
    this._createPath();
    this._drawNotebookBackground(); // ruled lines + margin — drawn before path
    this._drawPath();
    this._markPathOnGrid();
    this._createCursorIndicator();
    this._setupWaveManager();
    this._setupTowerManager();
    this._buildHUD();
    this._createToolbar();   // creates buttons + calls _selectTower('BASIC')
    this._createDustEmitter();
  }

  // --- Enemy textures -------------------------------------------------------

  _generateScribbleTexture() {
    if (this.textures.exists('enemy-scribble')) return;
    const gfx = this.make.graphics({ add: false });

    gfx.fillStyle(0xe8e2d4, 0.50);
    gfx.fillCircle(16, 16, 11);

    gfx.lineStyle(1.2, 0x2a2a2a, 0.80);
    const rings = [
      { ox: 0,  oy: 0,  r: 10 }, { ox: 2,  oy: 1,  r: 8 },
      { ox:-1,  oy: 2,  r: 6  }, { ox: 1,  oy:-1,  r: 4 },
      { ox:-2,  oy: 0,  r: 2  },
    ];
    for (const ring of rings) gfx.strokeCircle(16 + ring.ox, 16 + ring.oy, ring.r);

    gfx.lineStyle(1, 0x333333, 0.65);
    gfx.beginPath(); gfx.moveTo(8,  10); gfx.lineTo(22, 22); gfx.strokePath();
    gfx.beginPath(); gfx.moveTo(22, 10); gfx.lineTo(8,  22); gfx.strokePath();
    gfx.beginPath(); gfx.moveTo(6,  16); gfx.lineTo(26, 16); gfx.strokePath();

    gfx.lineStyle(0.7, 0x444444, 0.38);
    gfx.strokeCircle(16.5, 15.5, 10.5);

    gfx.generateTexture('enemy-scribble', 32, 32);
    gfx.destroy();
  }

  _generateEnemyTexture() {
    if (this.textures.exists('enemy-basic')) return;
    const gfx = this.make.graphics({ add: false });

    gfx.fillStyle(0xeae4d8, 0.70);
    gfx.fillTriangle(26, 16, 7, 5, 7, 27);

    gfx.lineStyle(0.7, 0x666666, 0.18);
    for (let d = -18; d <= 18; d += 3) {
      gfx.beginPath(); gfx.moveTo(7, 16 + d); gfx.lineTo(26, 16 + d + 2); gfx.strokePath();
    }
    gfx.lineStyle(0.7, 0x666666, 0.14);
    for (let d = -18; d <= 18; d += 4) {
      gfx.beginPath();
      gfx.moveTo(7 + Math.max(0, d), 5);
      gfx.lineTo(7 + Math.max(0, d) + 12, 27);
      gfx.strokePath();
    }

    gfx.lineStyle(1.5, 0x2a2a2a, 0.95);
    gfx.strokeTriangle(26, 16, 7, 5, 7, 27);
    gfx.lineStyle(0.7, 0x444444, 0.45);
    gfx.strokeTriangle(25, 16, 8, 4, 8, 28);

    gfx.generateTexture('enemy-basic', 32, 32);
    gfx.destroy();
  }

  // --- Grid -----------------------------------------------------------------

  _initGrid() {
    this.grid = Array.from({ length: GRID_ROWS }, () =>
      new Array(GRID_COLS).fill(0)
    );
  }

  // --- Path -----------------------------------------------------------------

  /**
   * Builds an orthogonal (ruler-straight) Phaser.Curves.Path from the current
   * level's waypoints array.  Each segment is a perfect horizontal or vertical
   * line — no Bezier curves.
   */
  _createPath() {
    const wp  = LEVELS[this.currentLevel - 1].waypoints;
    this.path = new Phaser.Curves.Path(wp[0][0], wp[0][1]);
    for (let i = 1; i < wp.length; i++) {
      this.path.lineTo(wp[i][0], wp[i][1]);
    }
  }

  // --- Notebook background --------------------------------------------------

  /**
   * Draws horizontal ruled lines and a red left-margin line, mimicking a
   * school-notebook page.  Depth -1 keeps it behind all game objects.
   */
  _drawNotebookBackground() {
    const gfx = this.add.graphics().setDepth(-1);

    // Ruled lines — school blue, every 24 px
    gfx.lineStyle(0.8, 0xc8e0f4, 0.68);
    for (let y = 24; y < 600; y += 24) {
      gfx.beginPath();
      gfx.moveTo(0, y);
      gfx.lineTo(800, y);
      gfx.strokePath();
    }

    // Red margin line — very slight tilt for hand-drawn feel
    gfx.lineStyle(1.2, 0xe05a5a, 0.48);
    gfx.beginPath();
    gfx.moveTo(60, 0);
    gfx.lineTo(60.5, 600);
    gfx.strokePath();

    // ── Aged-notebook stains ──────────────────────────────────────────────────
    // Coffee ring — top-left corner (concentric dried-ring effect)
    gfx.fillStyle(0xd2b48c, 0.05);
    gfx.fillCircle(18, 22, 19);
    gfx.lineStyle(1.5, 0xb8944c, 0.14);
    gfx.strokeCircle(18, 22, 19);
    gfx.lineStyle(0.8, 0xb8944c, 0.09);
    gfx.strokeCircle(18, 22, 15);  // inner ring
    gfx.lineStyle(0.5, 0xb8944c, 0.06);
    gfx.strokeCircle(18, 22, 11);  // faint third ring

    // Coffee ring — bottom-right corner
    gfx.fillStyle(0xd2b48c, 0.04);
    gfx.fillCircle(782, 578, 16);
    gfx.lineStyle(1.2, 0xb8944c, 0.11);
    gfx.strokeCircle(782, 578, 16);
    gfx.lineStyle(0.7, 0xb8944c, 0.07);
    gfx.strokeCircle(782, 578, 12);

    // Pencil smudge — bottom-left (graphite grey ellipse, very faint)
    gfx.fillStyle(0x777777, 0.04);
    gfx.fillEllipse(32, 512, 54, 28);

    // Pencil smudge — top-right
    gfx.fillStyle(0x666666, 0.035);
    gfx.fillEllipse(768, 38, 58, 24);
  }

  // --- Drawing --------------------------------------------------------------

  /**
   * Draws an imperfect hand-drawn rectangle using 4 individual pencil strokes.
   * Each stroke overshoots its corner by `overshoot` px and carries a tiny
   * tilt — exactly the "crossed corners" look of architectural sketches.
   *
   * @param {Phaser.GameObjects.Graphics} g
   * @param {number} x, y   Top-left origin
   * @param {number} w, h   Width and height
   * @param {number} lineWidth
   * @param {number} color  Hex color
   * @param {number} alpha
   * @param {number} overshoot  How many px each line extends past its corners
   */
  _sketchRect(g, x, y, w, h, lineWidth, color, alpha, overshoot = 3) {
    g.lineStyle(lineWidth, color, alpha);
    // Top edge — very slight downward drift at right end
    g.beginPath(); g.moveTo(x - overshoot, y + 0.7); g.lineTo(x + w + overshoot, y - 0.5); g.strokePath();
    // Bottom edge — very slight upward drift
    g.beginPath(); g.moveTo(x - overshoot + 1, y + h - 0.4); g.lineTo(x + w + overshoot - 1, y + h + 0.6); g.strokePath();
    // Left edge — very slight rightward lean at bottom
    g.beginPath(); g.moveTo(x + 0.4, y - overshoot); g.lineTo(x - 0.5, y + h + overshoot); g.strokePath();
    // Right edge
    g.beginPath(); g.moveTo(x + w + 0.3, y - overshoot + 1); g.lineTo(x + w - 0.4, y + h + overshoot); g.strokePath();
  }

  /**
   * Draws one pass of the orthogonal path — straight segments connecting
   * the current level's waypoints, with optional pixel offset for the
   * imperfect-pencil shadow/highlight layers.
   */
  _drawPathLayer(gfx, thickness, color, alpha, offsetX = 0, offsetY = 0) {
    const wp = LEVELS[this.currentLevel - 1].waypoints;
    gfx.lineStyle(thickness, color, alpha);
    gfx.beginPath();
    gfx.moveTo(wp[0][0] + offsetX, wp[0][1] + offsetY);
    for (let i = 1; i < wp.length; i++) {
      gfx.lineTo(wp[i][0] + offsetX, wp[i][1] + offsetY);
    }
    gfx.strokePath();
  }

  /**
   * Small ruler-stop crosses drawn at each interior corner — the "dibujo
   * técnico" tick mark that shows where a draftsperson lifted the pencil.
   */
  _drawCornerTicks(gfx) {
    const wp = LEVELS[this.currentLevel - 1].waypoints;
    gfx.lineStyle(1.4, 0x2a2a2a, 0.50);
    for (let i = 1; i < wp.length - 1; i++) {
      const [x, y] = wp[i];
      const T = 7; // tick half-length
      gfx.beginPath(); gfx.moveTo(x - T, y); gfx.lineTo(x + T, y); gfx.strokePath();
      gfx.beginPath(); gfx.moveTo(x, y - T); gfx.lineTo(x, y + T); gfx.strokePath();
      // small square at the corner — ruler corner mark
      gfx.lineStyle(0.7, 0x444444, 0.30);
      gfx.strokeRect(x - 3, y - 3, 6, 6);
      gfx.lineStyle(1.4, 0x2a2a2a, 0.50); // restore for next tick
    }
  }

  _drawPath() {
    this.pathGraphics = this.add.graphics(); // depth 0: drawn before enemies/towers in display list
    const gfx = this.pathGraphics;
    // Shadow layer — wide, light, gives the "eraser residue" look
    this._drawPathLayer(gfx, 22, 0x888888, 0.07,  0,    0);
    // Main graphite stroke
    this._drawPathLayer(gfx,  3, 0x2a2a2a, 0.72,  0,    0);
    // Offset highlight (hand-pressure variation)
    this._drawPathLayer(gfx,  1.5, 0x555555, 0.38,  1.2,  0.5);
    // Faint secondary line (double-stroke ruler feel)
    this._drawPathLayer(gfx,  1, 0x333333, 0.22, -0.8, -0.4);
    // Corner tick marks
    this._drawCornerTicks(gfx);
  }

  // --- Grid path-marking ----------------------------------------------------

  /**
   * Marks grid cells covered by the path.  Strict version: a cell is blocked
   * ONLY if its CENTER lies within PATH_HALF_WIDTH px of the path body —
   * computed as the exact perpendicular distance from the cell center to the
   * nearest path segment, not just sampled points.
   *
   * This frees up corner cells and tight edges that the older sampled-points
   * approach pessimistically blocked.
   */
  _markPathOnGrid() {
    const wp       = LEVELS[this.currentLevel - 1].waypoints;
    const radiusSq = PATH_HALF_WIDTH * PATH_HALF_WIDTH;

    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const cx = col * CELL_SIZE + CELL_SIZE / 2;
        const cy = row * CELL_SIZE + CELL_SIZE / 2;

        // Test against every path segment; mark blocked at first hit.
        for (let i = 1; i < wp.length; i++) {
          const dSq = this._pointToSegmentDistSq(cx, cy, wp[i - 1], wp[i]);
          if (dSq <= radiusSq) {
            this.grid[row][col] = 1;
            break;
          }
        }
      }
    }
  }

  /**
   * Squared perpendicular distance from point (px,py) to segment a→b.
   * Uses projection onto the segment, clamped to [0,1].
   */
  _pointToSegmentDistSq(px, py, a, b) {
    const ax = a[0], ay = a[1];
    const bx = b[0], by = b[1];
    const vx = bx - ax, vy = by - ay;
    const wx = px - ax, wy = py - ay;
    const segLenSq = vx * vx + vy * vy;
    if (segLenSq === 0) {
      // Degenerate: a == b → distance to point a
      return wx * wx + wy * wy;
    }
    let t = (wx * vx + wy * vy) / segLenSq;
    t = Math.max(0, Math.min(1, t));
    const closestX = ax + t * vx;
    const closestY = ay + t * vy;
    const dx = px - closestX;
    const dy = py - closestY;
    return dx * dx + dy * dy;
  }

  // --- Cursor indicator -----------------------------------------------------

  _createCursorIndicator() {
    this.cursorGraphics = this.add.graphics();
    this.cursorGraphics.setDepth(10);

    this.input.on('pointermove', (pointer) => {
      // Suppress grid cursor when hovering over the toolbar
      if (pointer.y >= BTN_Y) {
        this.cursorGraphics.clear();
        return;
      }

      const cellX = Math.floor(pointer.x / CELL_SIZE);
      const cellY = Math.floor(pointer.y / CELL_SIZE);

      this.cursorGraphics.clear();

      if (cellX < 0 || cellX >= GRID_COLS || cellY < 0 || cellY >= GRID_ROWS) return;

      const state     = this.grid[cellY][cellX];
      const canAfford = this.gold >= (this.towerManager?.selectedConfig.cost ?? Infinity);
      const free      = state === 0 && canAfford;

      const snapX = cellX * CELL_SIZE;
      const snapY = cellY * CELL_SIZE;
      const gfx   = this.cursorGraphics;
      const isInk = this.selectedTowerType === 'INK';
      const color = free ? (isInk ? 0x112288 : 0x2a2a2a) : 0x999999;
      const alpha = free ? 0.90 : 0.45;
      const L     = 9;
      const W     = CELL_SIZE;

      gfx.lineStyle(1.5, color, alpha);
      gfx.beginPath(); gfx.moveTo(snapX + L, snapY + 1); gfx.lineTo(snapX + 1, snapY + 1); gfx.lineTo(snapX + 1, snapY + L); gfx.strokePath();
      gfx.beginPath(); gfx.moveTo(snapX + W - L, snapY + 1); gfx.lineTo(snapX + W - 1, snapY + 1); gfx.lineTo(snapX + W - 1, snapY + L); gfx.strokePath();
      gfx.beginPath(); gfx.moveTo(snapX + 1, snapY + W - L); gfx.lineTo(snapX + 1, snapY + W - 1); gfx.lineTo(snapX + L, snapY + W - 1); gfx.strokePath();
      gfx.beginPath(); gfx.moveTo(snapX + W - 1, snapY + W - L); gfx.lineTo(snapX + W - 1, snapY + W - 1); gfx.lineTo(snapX + W - L, snapY + W - 1); gfx.strokePath();
    });

    this.input.on('pointerout', () => this.cursorGraphics.clear());
  }

  // --- Managers setup -------------------------------------------------------

  _setupWaveManager() {
    const lvl = LEVELS[this.currentLevel - 1];
    this.waveManager = new WaveManager(this, this.path, lvl.baseEnemyHP);

    this.events.on('enemyKilled', (reward, x, y) => {
      this.gold  += reward;
      this.score += reward;
      this._dustEmitter?.explode(13, x, y);

      // Persist high score immediately whenever it's beaten
      if (this.score > this.highScore) {
        this.highScore = this.score;
        localStorage.setItem('doodle_high_score', this.highScore);
      }
    });

    this.events.on('enemyEscaped', () => {
      this.lives = Math.max(0, this.lives - 1);
      // Tight 150 ms shake for damage feedback — the page "trembles" without
      // disrupting tower placement.
      this.cameras.main.shake(150, 0.006);
      if (this.lives <= 0) this._triggerGameOver();
    });
  }

  _setupTowerManager() {
    this.towerManager = new TowerManager(this);

    // Flag-based UI shield.
    // Any interactive UI element sets `_uiIntercepted = true` in its own
    // pointerdown BEFORE this global handler fires (Phaser dispatches object
    // events first, then the scene-level event).  The flag is consumed here
    // and reset so the very next click is evaluated fresh.
    this.input.on('pointerdown', (pointer) => {
      if (this._uiIntercepted) { this._uiIntercepted = false; return; }
      if (this._gameOver || this._levelTransitioning) return;
      if (this._leaderboardPromptOn)                  return;
      if (pointer.y >= BTN_Y)                         return; // toolbar zone safety-net
      if (pointer.leftButtonDown()) {
        this.towerManager.tryPlaceTower(pointer, this.grid);
      }
    });
  }

  // --- Tower selection ------------------------------------------------------

  /**
   * Activates a tower type: updates TowerManager config and highlights the
   * corresponding toolbar button with the ink-blue active border.
   * @param {'BASIC'|'INK'} type
   */
  _selectTower(type) {
    this.selectedTowerType = type;

    const CONFIGS = {
      BASIC: { type: 'BASIC', cost: 100, range: 120, fireRate: 1200, damage: 20, bulletSpeed: 260 },
      INK:   { type: 'INK',   cost: 175, range: 100, fireRate: 1800, damage:  8, bulletSpeed: 200 },
    };

    this.towerManager.selectedConfig = { ...CONFIGS[type] };

    if (this._towerBtns) {
      for (const [t, btn] of Object.entries(this._towerBtns)) {
        btn._activeBorder.setVisible(t === type);
      }
    }
  }

  // --- HUD ------------------------------------------------------------------

  _buildHUD() {
    // x=68: 8 px right of the red margin line at x=60
    this._hudText = this.add
      .text(68, 7, '', { fontFamily: FONT, fontSize: '13px', color: '#3a3a3a' })
      .setDepth(20);
  }

  _refreshHUD() {
    const lvl     = LEVELS[this.currentLevel - 1];
    const waveStr = `oleada: ${this.currentWave}/${lvl.maxWaves}`;
    this._hudText.setText(
      `nv: ${this.currentLevel}  ·  ${waveStr}  ·  vidas: ${this.lives}  ·  oro: ${this.gold}  ·  score: ${this.score}  ·  max: ${this.highScore}`
    );
  }

  // --- Toolbar (Neo-Minimalist floating dock) -------------------------------

  /**
   * Builds the bottom dock: a soft rounded-rect backdrop + tower buttons +
   * wave-launch button.  Everything sits on a translucent panel that floats
   * above the page — modern "drawing app" UI feel.
   */
  _createToolbar() {
    // Dock backdrop — single rounded-rect, semi-transparent cream
    const DOCK_X = 12, DOCK_Y = 527, DOCK_W = 776, DOCK_H = 63;
    const dock = this.add.graphics().setDepth(18);
    // Soft outer shadow (subtle, hand-tinted)
    dock.fillStyle(0x000000, 0.04);
    dock.fillRoundedRect(DOCK_X + 1, DOCK_Y + 2, DOCK_W, DOCK_H, 16);
    // Main panel
    dock.fillStyle(0xf2efe7, 0.88);
    dock.fillRoundedRect(DOCK_X, DOCK_Y, DOCK_W, DOCK_H, 16);
    // Hairline border
    dock.lineStyle(1, 0xb8b0a0, 0.40);
    dock.strokeRoundedRect(DOCK_X, DOCK_Y, DOCK_W, DOCK_H, 16);

    // Center buttons vertically inside the dock; nudge x positions for breathing room
    const btnY = DOCK_Y + (DOCK_H - BTN_H) / 2; // ≈ 532.5 → integer ≈ 533

    this._towerBtns = {
      BASIC: this._makeTowerButton(28,  btnY, 'BASIC', 'lápiz', 100),
      INK:   this._makeTowerButton(154, btnY, 'INK',   'tinta', 175),
    };
    this._waveBtn  = this._makeWaveButton(534, btnY);
    this._speedBtn = this._makeSpeedButton(730, btnY);

    // Set initial active state
    this._selectTower('BASIC');
  }

  /**
   * Floating 1x / 2x speed toggle on the dock's right edge.
   * Same Cubic.Out lift+scale hover animation as the rest of the dock.
   * Applies the speed factor to:
   *   - this.time.timeScale          → wave-spawn delays, delayedCalls
   *   - this.tweens.timeScale        → enemy path traversal + projectile tweens
   *   - this.physics.world.timeScale → physics step (inverted: 0.5 ⇒ 2× faster)
   */
  _makeSpeedButton(bx, by) {
    const W = SPEED_W, H = BTN_H;

    // Background
    const bg = this.make.graphics({ add: false });
    bg.fillStyle(0xfaf7f1, 0.94);
    bg.fillRoundedRect(0, 0, W, H, 12);
    bg.lineStyle(1, 0xb8b0a0, 0.55);
    bg.strokeRoundedRect(0, 0, W, H, 12);

    // Active-state tint (shown when speed > 1×)
    const activeTint = this.make.graphics({ add: false });
    activeTint.fillStyle(0xfde9c8, 0.65);
    activeTint.fillRoundedRect(0, 0, W, H, 12);
    activeTint.lineStyle(1.6, 0xc78a2a, 0.80);
    activeTint.strokeRoundedRect(0, 0, W, H, 12);
    activeTint.setVisible(false);

    const label = this.add.text(W / 2, H / 2, '1x', {
      fontFamily: FONT, fontSize: '16px', fontStyle: 'bold', color: '#1a1a1a',
    }).setOrigin(0.5);

    const container = this.add.container(bx, by, [bg, activeTint, label]);
    container.setDepth(20);
    container.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, W, H),
      Phaser.Geom.Rectangle.Contains
    );

    container._baseY     = by;
    container._baseScale = 1;
    container._label     = label;
    container._tint      = activeTint;

    container.on('pointerover', () => this._animateButtonHover(container, true));
    container.on('pointerout',  () => this._animateButtonHover(container, false));
    container.on('pointerdown', () => {
      this._uiIntercepted = true;
      if (this._gameOver) return;
      this._toggleGameSpeed();
    });

    return container;
  }

  /**
   * Alternates gameSpeed between 1 and 2 and propagates the new factor
   * to Phaser's three time-bound subsystems.  Phaser's `physics.world.timeScale`
   * is INVERTED (higher = slower) so we feed it the reciprocal.
   */
  _toggleGameSpeed() {
    this.gameSpeed = this.gameSpeed === 1 ? 2 : 1;

    this.time.timeScale          = this.gameSpeed;
    this.tweens.timeScale        = this.gameSpeed;
    this.physics.world.timeScale = 1 / this.gameSpeed;

    if (this._speedBtn) {
      this._speedBtn._label.setText(`${this.gameSpeed}x`);
      this._speedBtn._tint.setVisible(this.gameSpeed > 1);
      // Tiny scale pulse for tactile feedback (independent of the hover tween)
      this.tweens.add({
        targets:  this._speedBtn._label,
        scaleX:   1.18, scaleY: 1.18,
        duration: 110, yoyo: true, ease: 'Cubic.Out',
      });
    }
  }

  /**
   * Standard hover lift+scale animation for any dock button Container.
   * Idempotent: kills prior tweens on the target before starting a new one
   * so quick mouse movement can't leave the button stuck mid-transition.
   *
   * @param {Phaser.GameObjects.Container} container
   * @param {boolean} hovered  true → lift; false → return to base
   */
  _animateButtonHover(container, hovered) {
    this.tweens.killTweensOf(container);
    const baseY    = container._baseY ?? container.y;
    const baseSc   = container._baseScale ?? 1;
    this.tweens.add({
      targets:  container,
      y:        hovered ? baseY - 4 : baseY,
      scaleX:   hovered ? baseSc * 1.05 : baseSc,
      scaleY:   hovered ? baseSc * 1.05 : baseSc,
      duration: 150,
      ease:     Phaser.Math.Easing.Cubic.Out,
    });
  }

  /**
   * Tower-selector button.  Uses fillRoundedRect for the modern look:
   *   - Default state: soft cream fill, hairline grey border
   *   - Hover state:   lift -4px, scale 1.05 (via _animateButtonHover)
   *   - Active state:  ink-blue accent ring + slightly tinted fill
   */
  _makeTowerButton(bx, by, type, label, cost) {
    const W = TW_W, H = BTN_H;

    // ── Default background ───────────────────────────────────────────────
    const bg = this.make.graphics({ add: false });
    bg.fillStyle(0xfaf7f1, 0.94);
    bg.fillRoundedRect(0, 0, W, H, 12);
    bg.lineStyle(1, 0xb8b0a0, 0.55);
    bg.strokeRoundedRect(0, 0, W, H, 12);

    // ── Active indicator (shown when this tower type is selected) ────────
    const activeBorder = this.make.graphics({ add: false });
    activeBorder.fillStyle(0xe5ecf8, 0.55);
    activeBorder.fillRoundedRect(0, 0, W, H, 12);
    activeBorder.lineStyle(1.8, 0x2a4a8a, 0.85);
    activeBorder.strokeRoundedRect(0, 0, W, H, 12);
    activeBorder.setVisible(false);

    // ── Tower preview icon (right side) ──────────────────────────────────
    const preview = this.make.graphics({ add: false });
    const px = W - 24, py = H / 2;
    if (type === 'BASIC') {
      // Minimalist pencil-tower glyph
      preview.fillStyle(0xf0ebe0, 1);
      preview.fillCircle(px, py, 10);
      preview.lineStyle(1.2, 0x2a2a2a, 0.85);
      preview.strokeCircle(px, py, 10);
      preview.lineStyle(2, 0x2a2a2a, 0.90);
      preview.beginPath(); preview.moveTo(px + 2, py); preview.lineTo(px + 14, py); preview.strokePath();
    } else {
      // Minimalist ink-bottle glyph
      preview.fillStyle(0x0d1240, 0.94);
      preview.fillCircle(px, py, 10);
      preview.fillStyle(0x3a4ab0, 0.45);
      preview.fillCircle(px - 2, py - 2, 5);
      preview.fillStyle(0xffffff, 0.30);
      preview.fillCircle(px - 3, py - 3, 2.5);
      preview.lineStyle(1.2, 0x0a1130, 0.95);
      preview.strokeCircle(px, py, 10);
    }

    // ── Labels (left side) ───────────────────────────────────────────────
    const mainText = this.add.text(14, 10, label.toUpperCase(), {
      fontFamily: FONT, fontSize: '13px', fontStyle: 'bold', color: '#1a1a1a',
    });
    const costText = this.add.text(14, 30, `${cost}g`, {
      fontFamily: FONT, fontSize: '11px', color: '#7a7468',
    });

    // ── Assemble ─────────────────────────────────────────────────────────
    const container = this.add.container(bx, by);
    container.add([bg, activeBorder, preview, mainText, costText]);
    container.setDepth(20);
    container.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, W, H),
      Phaser.Geom.Rectangle.Contains
    );

    // Layout origin — _animateButtonHover returns to these values
    container._baseY      = by;
    container._baseScale  = 1;
    container._activeBorder = activeBorder;

    container.on('pointerover', () => this._animateButtonHover(container, true));
    container.on('pointerout',  () => this._animateButtonHover(container, false));
    container.on('pointerdown', () => {
      this._uiIntercepted = true;
      this._selectTower(type);
    });

    return container;
  }

  /**
   * Wave-launch button — the dock's primary CTA.  Same modern style as the
   * tower buttons but wider, with state-aware label and a disabled veil.
   */
  _makeWaveButton(bx, by) {
    const W = WAVE_W, H = BTN_H;

    // ── Background ───────────────────────────────────────────────────────
    const bg = this.make.graphics({ add: false });
    bg.fillStyle(0xfaf7f1, 0.94);
    bg.fillRoundedRect(0, 0, W, H, 14);
    bg.lineStyle(1, 0xb8b0a0, 0.55);
    bg.strokeRoundedRect(0, 0, W, H, 14);

    // ── Hover tint overlay (subtle ink-blue accent on hover) ─────────────
    const hoverBg = this.make.graphics({ add: false });
    hoverBg.fillStyle(0xe5ecf8, 0.60);
    hoverBg.fillRoundedRect(0, 0, W, H, 14);
    hoverBg.setAlpha(0);

    // ── Disabled veil ────────────────────────────────────────────────────
    const disabledOverlay = this.make.graphics({ add: false });
    disabledOverlay.fillStyle(0xfaf8f5, 0.72);
    disabledOverlay.fillRoundedRect(0, 0, W, H, 14);
    disabledOverlay.setVisible(false);

    // ── Labels ───────────────────────────────────────────────────────────
    const readyLabel = this.add.text(W / 2, H / 2, '▶  lanzar oleada', {
      fontFamily: FONT, fontSize: '15px', fontStyle: 'bold', color: '#1a1a1a',
    }).setOrigin(0.5, 0.5);

    const busyLabel = this.add.text(W / 2, H / 2, '·  oleada en curso  ·', {
      fontFamily: FONT, fontSize: '13px', color: '#9a948a',
    }).setOrigin(0.5, 0.5).setVisible(false);

    const container = this.add.container(bx, by);
    container.add([bg, hoverBg, disabledOverlay, readyLabel, busyLabel]);
    container.setDepth(20);
    container.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, W, H),
      Phaser.Geom.Rectangle.Contains
    );

    container._baseY            = by;
    container._baseScale        = 1;
    container._disabled         = false;
    container._hoverBg          = hoverBg;
    container._disabledOverlay  = disabledOverlay;
    container._readyLabel       = readyLabel;
    container._busyLabel        = busyLabel;

    container.on('pointerover', () => {
      if (container._disabled) return;
      this._animateButtonHover(container, true);
      this.tweens.add({ targets: hoverBg, alpha: 1, duration: 150, ease: Phaser.Math.Easing.Cubic.Out });
    });
    container.on('pointerout', () => {
      this._animateButtonHover(container, false);
      this.tweens.add({ targets: hoverBg, alpha: 0, duration: 150, ease: Phaser.Math.Easing.Cubic.Out });
    });
    container.on('pointerdown', () => {
      this._uiIntercepted = true;
      if (container._disabled || this._gameOver || this._levelTransitioning) return;
      const maxWaves = LEVELS[this.currentLevel - 1].maxWaves;
      if (this.currentWave >= maxWaves) return;
      this.currentWave++;
      this.waveManager.startWave(this.currentWave);
    });

    return container;
  }

  /**
   * Syncs wave-button visual state with the actual wave/enemy state.
   * Called every frame from update().
   */
  _updateWaveButton() {
    if (!this._waveBtn) return;

    const maxWaves     = LEVELS[this.currentLevel - 1].maxWaves;
    const allLaunched  = this.currentWave >= maxWaves;
    const shouldDisable = this.waveManager.isSpawning
                       || this.waveManager.getActiveEnemies().length > 0
                       || allLaunched
                       || this._levelTransitioning;

    // Update label text to reflect wave count
    const waveLabel = allLaunched
      ? '·  última oleada en curso  ·'
      : `>>  oleada ${this.currentWave + 1} / ${maxWaves}`;

    if (!shouldDisable) this._waveBtn._readyLabel.setText(waveLabel);

    if (shouldDisable === this._waveBtn._disabled) return; // no visual change needed

    this._waveBtn._disabled = shouldDisable;
    this._waveBtn._readyLabel.setVisible(!shouldDisable);
    this._waveBtn._busyLabel.setVisible(shouldDisable);
    this._waveBtn._disabledOverlay.setVisible(shouldDisable);

    if (shouldDisable) {
      this._waveBtn._hoverBg.setAlpha(0);
      // Snap back to base layout position so the disabled state doesn't
      // strand the button mid-hover-lift.
      this.tweens.killTweensOf(this._waveBtn);
      this._waveBtn.y      = this._waveBtn._baseY ?? this._waveBtn.y;
      this._waveBtn.scaleX = 1;
      this._waveBtn.scaleY = 1;
      this._waveBtn.disableInteractive();
    } else {
      this._waveBtn.setInteractive(
        new Phaser.Geom.Rectangle(0, 0, WAVE_W, BTN_H),
        Phaser.Geom.Rectangle.Contains
      );
    }
  }

  /**
   * Re-enables the wave button for the start of a new level (wave count reset).
   */
  _resetWaveButton() {
    if (!this._waveBtn) return;
    this._waveBtn._disabled = false;
    this._waveBtn._readyLabel.setVisible(true);
    this._waveBtn._busyLabel.setVisible(false);
    this._waveBtn._disabledOverlay.setVisible(false);
    this._waveBtn.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, WAVE_W, BTN_H),
      Phaser.Geom.Rectangle.Contains
    );
  }

  // --- Particle FX ----------------------------------------------------------

  _createDustEmitter() {
    if (!this.textures.exists('dust-chip')) {
      const g = this.make.graphics({ add: false });
      g.fillStyle(0x3a3a3a, 1);
      g.fillRect(0, 0, 3, 2);
      g.fillStyle(0x666666, 0.65);
      g.fillRect(1, 0, 1, 2);
      g.generateTexture('dust-chip', 4, 3);
      g.destroy();
    }

    this._dustEmitter = this.add.particles(0, 0, 'dust-chip', {
      speed:    { min: 35, max: 120 },
      angle:    { min: 0, max: 360 },
      scale:    { start: 1.3, end: 0 },
      alpha:    { start: 0.85, end: 0 },
      lifespan: { min: 240, max: 420 },
      gravityY: 100,
      rotate:   { min: 0, max: 360 },
      emitting: false,
    }).setDepth(12);
  }

  // --- Game Over ------------------------------------------------------------

  _triggerGameOver() {
    this._gameOver = true;

    // Disable toolbar so buttons don't intercept clicks through the overlay
    if (this._towerBtns) {
      Object.values(this._towerBtns).forEach(b => b.disableInteractive());
    }
    if (this._waveBtn) this._waveBtn.disableInteractive();

    this.cameras.main.shake(300, 0.010);

    const cx = 400, cy = 280;

    // Fading paper overlay
    const overlay = this.add.rectangle(cx, 300, 800, 600, 0xfaf8f5, 0).setDepth(30);
    this.tweens.add({ targets: overlay, alpha: 0.90, duration: 350, ease: 'Cubic.Out' });

    // Title
    const title = this.add.text(cx, cy, 'fin del juego', {
      fontFamily: FONT, fontSize: '42px', color: '#2a2a2a',
    }).setOrigin(0.5).setDepth(31).setAlpha(0);
    this.tweens.add({ targets: title, alpha: 1, duration: 400, delay: 200 });

    // Double-pencil strikethrough
    const strike = this.add.graphics().setDepth(32).setAlpha(0);
    this.tweens.add({ targets: strike, alpha: 1, duration: 300, delay: 500,
      onStart: () => {
        strike.lineStyle(2.5, 0x2a2a2a, 0.72);
        strike.beginPath(); strike.moveTo(cx - 155, cy - 3); strike.lineTo(cx + 155, cy + 5); strike.strokePath();
        strike.lineStyle(1.2, 0x555555, 0.40);
        strike.beginPath(); strike.moveTo(cx - 152, cy + 9); strike.lineTo(cx + 152, cy - 1); strike.strokePath();
      },
    });

    // Final score
    const scoreLabel = this.add.text(cx, cy + 58, `puntuación final:  ${this.score}`, {
      fontFamily: FONT, fontSize: '15px', color: '#666666',
    }).setOrigin(0.5).setDepth(31).setAlpha(0);
    this.tweens.add({ targets: scoreLabel, alpha: 1, duration: 400, delay: 620 });

    // High score (shown only if beaten — always shown for context)
    const isNewRecord = this.score >= this.highScore && this.score > 0;
    const hsText = isNewRecord
      ? `¡ nuevo récord!  ${this.highScore}`
      : `récord:  ${this.highScore}`;
    const hsColor = isNewRecord ? '#0a4a0a' : '#999999';
    const hsLabel = this.add.text(cx, cy + 76, hsText, {
      fontFamily: FONT, fontSize: '13px', color: hsColor,
    }).setOrigin(0.5).setDepth(31).setAlpha(0);
    this.tweens.add({ targets: hsLabel, alpha: 1, duration: 400, delay: 690 });

    // Clickable REINTENTAR button (interactive, hover changes color to ink-blue)
    const retryBtn = this.add.text(cx, cy + 102, '[ reintentar ]', {
      fontFamily: FONT, fontSize: '20px', color: '#2a2a2a',
    }).setOrigin(0.5).setDepth(33).setAlpha(0);

    retryBtn.setInteractive({ useHandCursor: true });
    retryBtn.on('pointerover', () => retryBtn.setStyle({ color: '#0a2288' }));
    retryBtn.on('pointerout',  () => retryBtn.setStyle({ color: '#2a2a2a' }));
    retryBtn.on('pointerdown', () => this.scene.restart());

    // Scribble underline under the retry button
    const retryLine = this.add.graphics().setDepth(33).setAlpha(0);
    const rbw = 130; // approximate button width
    retryLine.lineStyle(1.2, 0x2a2a2a, 0.65);
    retryLine.beginPath();
    retryLine.moveTo(cx - rbw / 2,       cy + 114);
    retryLine.lineTo(cx - rbw / 2 + rbw * 0.55, cy + 112.5);
    retryLine.lineTo(cx + rbw / 2,       cy + 114.5);
    retryLine.strokePath();

    this.tweens.add({ targets: [retryBtn, retryLine], alpha: 1, duration: 400, delay: 780 });

    // Offer to submit to the global leaderboard if the score qualifies.
    // Done after the overlay finishes its entrance so the prompt isn't jarring.
    this.time.delayedCall(1100, () => this._maybeSubmitToLeaderboard('fin del juego'));
  }

  // --- Global leaderboard submission ----------------------------------------

  /**
   * Fetches the current top 20, checks whether `this.score` would land in it,
   * and if so renders an in-scene nickname-entry overlay.  The overlay uses
   * Phaser objects only — no DOM elements — and submits via fetch() POST.
   *
   * @param {string} contextLabel  Short caption shown above the prompt
   *                               (e.g. "fin del juego" or "¡graduado!").
   */
  async _maybeSubmitToLeaderboard(contextLabel) {
    if (this.score <= 0)              return;
    if (this._leaderboardPromptOn)    return;
    if (this._leaderboardSubmitted)   return; // spam-lock — one submit per run

    const qualifies = await isTopScore(this.score, 20);
    if (!qualifies)                 return;
    if (!this.scene.isActive())     return; // scene torn down while we waited

    this._showNicknamePrompt(contextLabel);
  }

  /**
   * Modern neo-minimalist nickname-entry card:
   *   - Floating card with soft shadow, rounded corners, translucent cream fill
   *   - Live-updating input field with blinking caret (driven by keyboard)
   *   - Explicit [ SUBMIT ] button styled like the dock buttons (hover lift+scale)
   *   - Spam-lock: once submission succeeds we set `_leaderboardSubmitted = true`
   *     so the prompt never reappears for the same run, even if both game-over
   *     and graduation paths fire it.
   */
  _showNicknamePrompt(contextLabel) {
    this._leaderboardPromptOn = true;

    const cx = 400, cy = 472;
    const W = 420, H = 132;
    const MAX_NICK = 14;
    let nickname  = (localStorage.getItem('doodle_last_nick') || '').slice(0, MAX_NICK);
    let submitted = false; // local guard while the prompt is on screen

    // ── Card ──────────────────────────────────────────────────────────────
    const card = this.add.graphics().setDepth(50).setAlpha(0);
    // Soft drop-shadow
    card.fillStyle(0x000000, 0.10);
    card.fillRoundedRect(cx - W / 2 + 2, cy - H / 2 + 4, W, H, 18);
    // Main translucent cream panel
    card.fillStyle(0xfaf7f1, 0.96);
    card.fillRoundedRect(cx - W / 2, cy - H / 2, W, H, 18);
    // Hairline border
    card.lineStyle(1, 0xb8b0a0, 0.55);
    card.strokeRoundedRect(cx - W / 2, cy - H / 2, W, H, 18);
    this.tweens.add({ targets: card, alpha: 1, duration: 220, ease: 'Cubic.Out' });

    // ── Caption row ──────────────────────────────────────────────────────
    const caption = this.add.text(cx, cy - H / 2 + 16, `${contextLabel}  ·  ¡entras al top 20!`, {
      fontFamily: FONT, fontSize: '12px', color: '#7a7468', fontStyle: 'italic',
    }).setOrigin(0.5).setDepth(51).setAlpha(0);
    this.tweens.add({ targets: caption, alpha: 1, duration: 220, delay: 60 });

    // ── Field label ──────────────────────────────────────────────────────
    const promptText = this.add.text(cx - W / 2 + 24, cy - 16, 'nickname', {
      fontFamily: FONT, fontSize: '11px', color: '#9a948a',
    }).setOrigin(0, 0).setDepth(51).setAlpha(0);
    this.tweens.add({ targets: promptText, alpha: 1, duration: 220, delay: 100 });

    // ── Input field background (rounded "input pill") ────────────────────
    const FIELD_X = cx - W / 2 + 24;
    const FIELD_Y = cy - 2;
    const FIELD_W = W - 48;
    const FIELD_H = 34;
    const field   = this.add.graphics().setDepth(50).setAlpha(0);
    field.fillStyle(0xffffff, 0.65);
    field.fillRoundedRect(FIELD_X, FIELD_Y, FIELD_W, FIELD_H, 10);
    field.lineStyle(1, 0xb8b0a0, 0.50);
    field.strokeRoundedRect(FIELD_X, FIELD_Y, FIELD_W, FIELD_H, 10);
    this.tweens.add({ targets: field, alpha: 1, duration: 220, delay: 140 });

    // ── Input display (centered text inside the pill) ────────────────────
    const inputDisplay = this.add.text(FIELD_X + FIELD_W / 2, FIELD_Y + FIELD_H / 2,
      nickname + '|',
      { fontFamily: FONT, fontSize: '18px', fontStyle: 'bold', color: '#1a1a1a' }
    ).setOrigin(0.5).setDepth(51).setAlpha(0);
    this.tweens.add({ targets: inputDisplay, alpha: 1, duration: 220, delay: 180 });

    // Blinking caret driven by tween
    let caretShown = true;
    const caretTimer = this.time.addEvent({
      delay: 480, loop: true,
      callback: () => {
        if (submitted) return;
        caretShown = !caretShown;
        inputDisplay.setText(nickname + (caretShown ? '|' : ' '));
      },
    });

    // ── Status line ──────────────────────────────────────────────────────
    const hint = this.add.text(cx, cy + H / 2 - 16,
      'escribe tu nombre  ·  enter / submit  ·  esc cancela',
      { fontFamily: FONT, fontSize: '10px', color: '#9a948a' }
    ).setOrigin(0.5).setDepth(51).setAlpha(0);
    this.tweens.add({ targets: hint, alpha: 1, duration: 220, delay: 240 });

    // ── SUBMIT button (modern lift-hover style) ──────────────────────────
    const btnW = 110, btnH = 32;
    const btnX = cx + W / 2 - btnW / 2 - 18;
    const btnY = cy + 28;
    const btn  = this._buildSubmitButton(btnX, btnY, btnW, btnH, () => submit());
    btn.setDepth(52).setAlpha(0);
    this.tweens.add({ targets: btn, alpha: 1, duration: 220, delay: 220 });

    const objs = [card, caption, promptText, field, inputDisplay, hint, btn];

    const cleanup = () => {
      caretTimer.remove(false);
      this.input.keyboard.off('keydown', onKey);
      this.tweens.add({
        targets:  objs,
        alpha:    0,
        duration: 180,
        ease:     'Cubic.Out',
        onComplete: () => objs.forEach(o => { if (o && o.active) o.destroy(); }),
      });
      this._leaderboardPromptOn = false;
    };

    const submit = async () => {
      if (submitted) return;
      const finalNick = nickname.trim();
      if (finalNick.length === 0) {
        hint.setStyle({ color: '#8a3030' });
        hint.setText('escribe al menos un carácter.');
        return;
      }

      submitted = true;
      localStorage.setItem('doodle_last_nick', finalNick);

      // Lock the submit button visually
      btn._setEnabled(false);
      inputDisplay.setText(finalNick);
      hint.setStyle({ color: '#7a7468' });
      hint.setText('enviando…');

      const result = await submitScore(finalNick, this.score);

      if (result.ok && (result.action === 'created' || result.action === 'updated')) {
        this._leaderboardSubmitted = true; // global spam-lock for this run
        const rankStr = result.rank ? `puesto #${result.rank}` : 'registrado';
        hint.setStyle({ color: '#1a4a1a' });
        hint.setText(`¡guardado!  ·  ${rankStr}`);
      } else if (result.ok && result.action === 'no_change') {
        this._leaderboardSubmitted = true;
        hint.setStyle({ color: '#9a948a' });
        hint.setText('tu récord previo es mayor — no se actualiza.');
      } else {
        hint.setStyle({ color: '#8a3030' });
        hint.setText(`no se pudo enviar (${result.error || 'error'}).`);
        // On failure, let the user retry — re-enable button
        submitted = false;
        btn._setEnabled(true);
        return;
      }

      this.time.delayedCall(1800, cleanup);
    };

    const onKey = (evt) => {
      if (submitted) return;
      if (evt.key === 'Enter')  { submit(); return; }
      if (evt.key === 'Escape') { cleanup(); return; }
      if (evt.key === 'Backspace') {
        nickname = nickname.slice(0, -1);
        inputDisplay.setText(nickname + '|');
        return;
      }
      if (evt.key.length === 1 && /[A-Za-z0-9 _\-]/.test(evt.key) && nickname.length < MAX_NICK) {
        nickname += evt.key;
        inputDisplay.setText(nickname + '|');
      }
    };

    this.input.keyboard.on('keydown', onKey);
  }

  /**
   * Reusable submit-button Container — rounded rect, fillRoundedRect, with the
   * same hover lift+scale animation used by the dock buttons.
   */
  _buildSubmitButton(x, y, W, H, onClick) {
    const bg = this.make.graphics({ add: false });
    bg.fillStyle(0x2a4a8a, 0.95);
    bg.fillRoundedRect(0, 0, W, H, 10);
    bg.lineStyle(1, 0x1a3a7a, 0.65);
    bg.strokeRoundedRect(0, 0, W, H, 10);

    const label = this.add.text(W / 2, H / 2, '[ SUBMIT ]', {
      fontFamily: FONT, fontSize: '13px', fontStyle: 'bold', color: '#ffffff',
    }).setOrigin(0.5);

    const disabledOverlay = this.make.graphics({ add: false });
    disabledOverlay.fillStyle(0xfaf8f5, 0.55);
    disabledOverlay.fillRoundedRect(0, 0, W, H, 10);
    disabledOverlay.setVisible(false);

    const container = this.add.container(x, y);
    container.add([bg, label, disabledOverlay]);
    container.setInteractive(
      new Phaser.Geom.Rectangle(0, 0, W, H),
      Phaser.Geom.Rectangle.Contains
    );

    container._baseY     = y;
    container._baseScale = 1;
    container._enabled   = true;

    container._setEnabled = (on) => {
      container._enabled = on;
      disabledOverlay.setVisible(!on);
      if (!on) {
        this.tweens.killTweensOf(container);
        container.y = container._baseY;
        container.scaleX = 1;
        container.scaleY = 1;
        container.disableInteractive();
      } else {
        container.setInteractive(
          new Phaser.Geom.Rectangle(0, 0, W, H),
          Phaser.Geom.Rectangle.Contains
        );
      }
    };

    container.on('pointerover', () => {
      if (!container._enabled) return;
      this._animateButtonHover(container, true);
    });
    container.on('pointerout', () => {
      if (!container._enabled) return;
      this._animateButtonHover(container, false);
    });
    container.on('pointerdown', () => {
      this._uiIntercepted = true;
      if (!container._enabled) return;
      onClick();
    });

    return container;
  }

  // --- Level progression ----------------------------------------------------

  /**
   * Checked every frame.  When the last wave of the current level has finished
   * spawning AND all enemies are gone, trigger the level-complete screen.
   */
  _checkLevelComplete() {
    const lvl = LEVELS[this.currentLevel - 1];
    if (this.currentWave < lvl.maxWaves)                      return;
    if (this.waveManager.isSpawning)                          return;
    if (this.waveManager.getActiveEnemies().length > 0)       return;
    if (this._levelTransitioning)                             return;

    this._levelTransitioning = true;
    this._triggerLevelComplete();
  }

  _triggerLevelComplete() {
    const isLastLevel = this.currentLevel >= LEVELS.length;

    // Freeze toolbar
    if (this._towerBtns) Object.values(this._towerBtns).forEach(b => b.disableInteractive());
    if (this._waveBtn)    this._waveBtn.disableInteractive();

    const cx = 400, cy = 255;
    const objs = []; // track everything so we can fade out together

    // Semi-opaque paper overlay
    const overlay = this.add.rectangle(cx, 300, 800, 600, 0xfaf8f5, 0).setDepth(40);
    objs.push(overlay);
    this.tweens.add({ targets: overlay, alpha: 0.92, duration: 350, ease: 'Cubic.Out' });

    // Main title
    const titleStr = isLastLevel ? '¡ graduado !' : '¡ nivel completado !';
    const title = this.add.text(cx, cy - 18, titleStr, {
      fontFamily: FONT, fontSize: '44px', fontStyle: 'bold', color: '#1a4a1a',
    }).setOrigin(0.5).setDepth(41).setAlpha(0);
    objs.push(title);
    this.tweens.add({ targets: title, alpha: 1, duration: 400, delay: 200 });

    // Sketch underline beneath title (appears after title fades in)
    const underline = this.add.graphics().setDepth(42).setAlpha(0);
    objs.push(underline);
    this.tweens.add({
      targets: underline, alpha: 1, duration: 280, delay: 520,
      onStart: () => {
        const tw = title.width;
        underline.lineStyle(2.5, 0x1a4a1a, 0.68);
        underline.beginPath();
        underline.moveTo(cx - tw / 2,              cy + 32);
        underline.lineTo(cx - tw / 2 + tw * 0.55,  cy + 30.5);
        underline.lineTo(cx + tw / 2,              cy + 33);
        underline.strokePath();
      },
    });

    if (isLastLevel) {
      // Final score
      const scoreLabel = this.add.text(cx, cy + 58, `puntuación final:  ${this.score}`, {
        fontFamily: FONT, fontSize: '17px', color: '#3a3a3a',
      }).setOrigin(0.5).setDepth(41).setAlpha(0);
      objs.push(scoreLabel);
      this.tweens.add({ targets: scoreLabel, alpha: 1, duration: 400, delay: 550 });

      // High-score line
      const isNew = this.score >= this.highScore && this.score > 0;
      const hsLabel = this.add.text(cx, cy + 80,
        isNew ? `¡ nuevo récord!  ${this.highScore}` : `récord:  ${this.highScore}`, {
        fontFamily: FONT, fontSize: '13px', color: isNew ? '#0a4a0a' : '#888888',
      }).setOrigin(0.5).setDepth(41).setAlpha(0);
      objs.push(hsLabel);
      this.tweens.add({ targets: hsLabel, alpha: 1, duration: 400, delay: 650 });

      // Menu button
      const menuBtn = this.add.text(cx, cy + 118, '[ volver al menú ]', {
        fontFamily: FONT, fontSize: '20px', color: '#2a2a2a',
      }).setOrigin(0.5).setDepth(42).setAlpha(0);
      objs.push(menuBtn);
      menuBtn.setInteractive({ useHandCursor: true });
      menuBtn.on('pointerover', () => menuBtn.setStyle({ color: '#0a2288' }));
      menuBtn.on('pointerout',  () => menuBtn.setStyle({ color: '#2a2a2a' }));
      menuBtn.on('pointerdown', () => this.scene.start('MenuScene'));
      this.tweens.add({ targets: menuBtn, alpha: 1, duration: 400, delay: 780 });

      // Offer to submit to the global leaderboard after the panel settles
      this.time.delayedCall(1100, () => this._maybeSubmitToLeaderboard('¡graduado!'));
    } else {
      // "Loading next level" line
      const subText = this.add.text(cx, cy + 42, 'cargando siguiente tarea...', {
        fontFamily: FONT, fontSize: '14px', color: '#555555',
      }).setOrigin(0.5).setDepth(41).setAlpha(0);
      objs.push(subText);
      this.tweens.add({ targets: subText, alpha: 1, duration: 400, delay: 420 });

      const scoreText = this.add.text(cx, cy + 64, `puntuación acumulada:  ${this.score}`, {
        fontFamily: FONT, fontSize: '13px', color: '#888888',
      }).setOrigin(0.5).setDepth(41).setAlpha(0);
      objs.push(scoreText);
      this.tweens.add({ targets: scoreText, alpha: 1, duration: 400, delay: 560 });

      // After 2.2 s: fade out overlay then advance
      this.time.delayedCall(2200, () => {
        objs.forEach(o => {
          this.tweens.add({
            targets: o, alpha: 0, duration: 240,
            onComplete: () => { if (o && o.active) o.destroy(); },
          });
        });
        this.time.delayedCall(260, () => this._advanceToNextLevel());
      });
    }
  }

  /**
   * Performs the full state reset needed to enter the next campaign level:
   * destroys towers, rebuilds path, resets wave counter, re-enables UI.
   */
  _advanceToNextLevel() {
    this.currentLevel++;
    this.currentWave    = 0;

    // 1. Tear down towers (no refund — campaign rule)
    this.towerManager.destroyAll();

    // 2. Reset grid
    this._initGrid();

    // 3. Rebuild & redraw path for the new level
    this._createPath();
    if (this.pathGraphics) { this.pathGraphics.destroy(); this.pathGraphics = null; }
    this._drawPath();
    this._markPathOnGrid();

    // 4. Reset WaveManager (clears any leftover enemies, updates path + base HP)
    const lvl = LEVELS[this.currentLevel - 1];
    this.waveManager.reset(this.path, lvl.baseEnemyHP);

    // 5. Re-enable toolbar
    if (this._towerBtns) {
      Object.values(this._towerBtns).forEach(b => b.setInteractive(
        new Phaser.Geom.Rectangle(0, 0, TW_W, BTN_H),
        Phaser.Geom.Rectangle.Contains
      ));
    }
    this._resetWaveButton();

    // 6. Clear transitioning flag last (guards update() checks above)
    this._levelTransitioning = false;
  }

  // --- Game loop ------------------------------------------------------------

  update(time) {
    if (this._gameOver || this._levelTransitioning) return;

    // Remove stale enemy references from the physics group
    const enemies = this.waveManager.getActiveEnemies();
    for (let i = enemies.length - 1; i >= 0; i--) {
      if (!enemies[i].active) {
        this.waveManager.enemyGroup.remove(enemies[i], true, true);
      }
    }

    this.towerManager.updateAll(time, enemies);
    this._refreshHUD();
    this._updateWaveButton();
    this._checkLevelComplete();
  }
}
