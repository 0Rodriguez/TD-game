import Phaser from 'phaser';
import { fetchLeaderboard } from '../services/leaderboardApi.js';

const FONT = '"Georgia", "Palatino Linotype", serif';

export default class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MenuScene' });
  }

  create() {
    this._leaderboardOpen = false;
    this._leaderboardObjs = []; // tracked so we can tear down on close

    this._drawNotebookBackground();
    this._buildDecorativePencil();
    this._buildMarginDoodles();
    this._buildTitle();
    this._buildStartButton();
    this._buildHighScore();
    this._buildLeaderboardButton();
    this._buildFooter();
  }

  // ---- Notebook background (mirror of GameScene) ---------------------------

  _drawNotebookBackground() {
    const gfx = this.add.graphics().setDepth(-1);

    // Horizontal ruled lines — school blue, every 24 px
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
  }

  // ---- Sketch utilities (mirror of GameScene) ------------------------------

  /**
   * Draws 4 crossing sketch lines — the "architect's corner" border style.
   * Each line overshoots by `overshoot` px and carries a tiny imperfect tilt.
   */
  _sketchRect(g, x, y, w, h, lineWidth, color, alpha, overshoot = 3) {
    g.lineStyle(lineWidth, color, alpha);
    g.beginPath(); g.moveTo(x - overshoot, y + 0.7); g.lineTo(x + w + overshoot, y - 0.5); g.strokePath();
    g.beginPath(); g.moveTo(x - overshoot + 1, y + h - 0.4); g.lineTo(x + w + overshoot - 1, y + h + 0.6); g.strokePath();
    g.beginPath(); g.moveTo(x + 0.4, y - overshoot); g.lineTo(x - 0.5, y + h + overshoot); g.strokePath();
    g.beginPath(); g.moveTo(x + w + 0.3, y - overshoot + 1); g.lineTo(x + w - 0.4, y + h + overshoot); g.strokePath();
  }

  // ---- Decorative elements -------------------------------------------------

  /**
   * If the pencil SVG was loaded by BootScene, shows it large and faded
   * behind the content as a thematic background element.
   */
  _buildDecorativePencil() {
    if (!this.textures.exists('pencil_tower')) return;

    const pencil = this.add.image(690, 300, 'pencil_tower')
      .setScale(5.5)
      .setAlpha(0.07)
      .setDepth(0);

    // Slow idle sway
    this.tweens.add({
      targets:  pencil,
      angle:    6,
      yoyo:     true,
      repeat:   -1,
      duration: 4000,
      ease:     'Sine.InOut',
    });
  }

  /**
   * Small pencil doodles along the margin — gives the page a "used notebook"
   * quality without cluttering the main content area.
   */
  _buildMarginDoodles() {
    const gfx = this.add.graphics().setDepth(3);

    // Asterisk near title area (in the left margin)
    gfx.lineStyle(1.2, 0x2a2a2a, 0.38);
    const ax = 32, ay = 210;
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI) / 3;
      gfx.beginPath();
      gfx.moveTo(ax + Math.cos(a) * 7, ay + Math.sin(a) * 7);
      gfx.lineTo(ax - Math.cos(a) * 7, ay - Math.sin(a) * 7);
      gfx.strokePath();
    }

    // Sketched rectangle in margin near button
    gfx.lineStyle(1, 0x2a2a2a, 0.30);
    this._sketchRect(gfx, 16, 338, 22, 22, 1, 0x2a2a2a, 0.30, 2);
    // Diagonal corner hatch inside the square (selection indicator style)
    gfx.lineStyle(0.7, 0x2a2a2a, 0.22);
    for (let i = 2; i <= 14; i += 4) {
      gfx.beginPath(); gfx.moveTo(16, 338 + i); gfx.lineTo(16 + i, 338); gfx.strokePath();
    }

    // Tiny triangle near footer
    gfx.lineStyle(0.9, 0x2a2a2a, 0.28);
    gfx.beginPath();
    gfx.moveTo(24, 472); gfx.lineTo(38, 472); gfx.lineTo(31, 461);
    gfx.closePath(); gfx.strokePath();
  }

  // ---- Title ---------------------------------------------------------------

  _buildTitle() {
    const cx = 400;

    // Main title
    const title = this.add.text(cx, 185, 'DOODLE DEFENSE', {
      fontFamily: FONT,
      fontSize:   '58px',
      fontStyle:  'bold',
      color:      '#2a2a2a',
    }).setOrigin(0.5).setDepth(5);

    // Subtitle / tagline
    this.add.text(cx, 258, 'defensa de escritorio', {
      fontFamily: FONT,
      fontSize:   '17px',
      color:      '#666666',
    }).setOrigin(0.5).setDepth(5);

    // ---- Imperfect sketch underlines beneath the main title ----
    const gfx = this.add.graphics().setDepth(5);
    const tw  = title.width;

    // Primary stroke — wider, more opaque
    gfx.lineStyle(2.5, 0x2a2a2a, 0.72);
    gfx.beginPath();
    gfx.moveTo(cx - tw / 2,             226);
    gfx.lineTo(cx - tw / 2 + tw * 0.55, 224.5);
    gfx.lineTo(cx + tw / 2,             226.5);
    gfx.strokePath();

    // Secondary stroke — offset by ~5 px, lighter, shorter
    gfx.lineStyle(1.2, 0x555555, 0.38);
    gfx.beginPath();
    gfx.moveTo(cx - tw / 2 + 8,   231.5);
    gfx.lineTo(cx + tw * 0.28,    230);
    gfx.lineTo(cx + tw / 2 - 8,   232);
    gfx.strokePath();
  }

  // ---- Start button --------------------------------------------------------

  _buildStartButton() {
    const cx = 400, cy = 358;
    const W = 228, H = 58;
    const bx = cx - W / 2;
    const by = cy - H / 2;

    // Paper background with double sketch border (same style as toolbar buttons)
    const bg = this.add.graphics().setDepth(10);
    bg.fillStyle(0xf5f1eb, 1);
    bg.fillRect(bx, by, W, H);
    this._sketchRect(bg, bx, by, W, H, 1.4, 0x2a2a2a, 0.86, 3);
    this._sketchRect(bg, bx + 2, by + 2, W - 3, H - 3, 0.6, 0x666666, 0.38, 2);

    // Button text
    const label = this.add.text(cx, cy, '[ empezar tarea ]', {
      fontFamily: FONT,
      fontSize:   '19px',
      color:      '#2a2a2a',
    }).setOrigin(0.5).setDepth(11);

    // Scribble underline — fades in on hover
    const lw = label.width;
    const underline = this.add.graphics().setDepth(11).setAlpha(0);
    underline.lineStyle(1.3, 0x112288, 0.80);
    underline.beginPath();
    underline.moveTo(cx - lw / 2,              cy + 15);
    underline.lineTo(cx - lw / 2 + lw * 0.55,  cy + 13.5);
    underline.lineTo(cx + lw / 2,              cy + 15.5);
    underline.strokePath();

    // Phaser.GameObjects.Zone — zero-visual hit area, designed for exactly this.
    // Placed at depth 12 so it sits above the Graphics and Text objects.
    const zone = this.add.zone(cx, cy, W, H)
      .setInteractive({ useHandCursor: true })
      .setDepth(12);

    zone.on('pointerover', () => {
      label.setStyle({ color: '#0a2288' });
      this.tweens.add({ targets: underline, alpha: 1, duration: 130, ease: 'Linear' });
    });

    zone.on('pointerout', () => {
      label.setStyle({ color: '#2a2a2a' });
      this.tweens.add({ targets: underline, alpha: 0, duration: 100, ease: 'Linear' });
    });

    zone.on('pointerdown', () => {
      // Clean scene transition — no keyboard shortcut needed
      this.scene.start('GameScene');
    });
  }

  // ---- High score ----------------------------------------------------------

  _buildHighScore() {
    const hs = parseInt(localStorage.getItem('doodle_high_score')) || 0;

    const label = hs > 0
      ? `récord histórico:  ${hs}`
      : 'récord histórico:  —';

    this.add.text(400, 430, label, {
      fontFamily: FONT,
      fontSize:   '14px',
      color:      '#666666',
    }).setOrigin(0.5).setDepth(5);
  }

  // ---- Hover animation helper ----------------------------------------------

  /**
   * Shared lift + scale animation for any styled Container button.
   * Kills prior tweens so quick mouse movement can't strand the button.
   */
  _animateButtonHover(container, hovered) {
    this.tweens.killTweensOf(container);
    const baseY  = container._baseY ?? container.y;
    const baseSc = container._baseScale ?? 1;
    this.tweens.add({
      targets:  container,
      y:        hovered ? baseY - 4 : baseY,
      scaleX:   hovered ? baseSc * 1.05 : baseSc,
      scaleY:   hovered ? baseSc * 1.05 : baseSc,
      duration: 150,
      ease:     Phaser.Math.Easing.Cubic.Out,
    });
  }

  // ---- Leaderboard button --------------------------------------------------

  /**
   * Modern styled button below the high-score:  [ 🏆 VER LEADERBOARD ]
   * fillRoundedRect, soft shadow, lift+scale on hover (same easing as the
   * in-game dock buttons).  Sits at depth 5 alongside the other menu UI.
   */
  _buildLeaderboardButton() {
    const cx = 400, cy = 466;
    const W = 220, H = 36;

    // Soft shadow
    const shadow = this.make.graphics({ add: false });
    shadow.fillStyle(0x000000, 0.06);
    shadow.fillRoundedRect(-W / 2 + 1, -H / 2 + 2, W, H, 12);

    // Main background
    const bg = this.make.graphics({ add: false });
    bg.fillStyle(0xfaf7f1, 0.92);
    bg.fillRoundedRect(-W / 2, -H / 2, W, H, 12);
    bg.lineStyle(1, 0xb8b0a0, 0.55);
    bg.strokeRoundedRect(-W / 2, -H / 2, W, H, 12);

    // Hover accent overlay (cross-fades in)
    const hoverBg = this.make.graphics({ add: false });
    hoverBg.fillStyle(0xe5ecf8, 0.65);
    hoverBg.fillRoundedRect(-W / 2, -H / 2, W, H, 12);
    hoverBg.setAlpha(0);

    const label = this.add.text(0, 0, '🏆   VER LEADERBOARD', {
      fontFamily: FONT, fontSize: '13px', fontStyle: 'bold', color: '#1a1a1a',
    }).setOrigin(0.5);

    const container = this.add.container(cx, cy, [shadow, bg, hoverBg, label]).setDepth(5);
    container.setInteractive(
      new Phaser.Geom.Rectangle(-W / 2, -H / 2, W, H),
      Phaser.Geom.Rectangle.Contains
    );
    container._baseY     = cy;
    container._baseScale = 1;

    container.on('pointerover', () => {
      this._animateButtonHover(container, true);
      this.tweens.add({ targets: hoverBg, alpha: 1, duration: 150, ease: 'Cubic.Out' });
      label.setStyle({ color: '#2a4a8a' });
    });
    container.on('pointerout', () => {
      this._animateButtonHover(container, false);
      this.tweens.add({ targets: hoverBg, alpha: 0, duration: 150, ease: 'Cubic.Out' });
      label.setStyle({ color: '#1a1a1a' });
    });
    container.on('pointerdown', () => {
      if (this._leaderboardOpen) return;
      this._openLeaderboardOverlay();
    });
  }

  // ---- Leaderboard overlay -------------------------------------------------

  async _openLeaderboardOverlay() {
    this._leaderboardOpen = true;

    // ── Dim translucent shield (click-to-close) ──────────────────────────
    const dim = this.add.rectangle(400, 300, 800, 600, 0x000000, 0).setDepth(40);
    dim.setInteractive();
    this._leaderboardObjs.push(dim);
    this.tweens.add({ targets: dim, alpha: 0.42, duration: 220, ease: 'Cubic.Out' });
    dim.on('pointerdown', () => this._closeLeaderboardOverlay());

    // ── Loading text (centered while fetch in-flight) ────────────────────
    const loading = this.add.text(400, 300, 'cargando ranking…', {
      fontFamily: FONT, fontSize: '14px', color: '#ffffff',
    }).setOrigin(0.5).setDepth(43).setAlpha(0);
    this._leaderboardObjs.push(loading);
    this.tweens.add({ targets: loading, alpha: 1, duration: 200, delay: 120 });

    // ── Fetch ───────────────────────────────────────────────────────────
    const scores = await fetchLeaderboard();
    if (!this._leaderboardOpen) return; // closed while we waited

    loading.destroy();
    this._leaderboardObjs = this._leaderboardObjs.filter(o => o !== loading);

    this._drawLeaderboardTable(scores);
  }

  /**
   * Renders the modern leaderboard modal:
   *   - Rounded card with soft shadow
   *   - Compact header row
   *   - Per-row alternating subtle background tint, top-3 highlighted blue
   *   - Styled [ CERRAR ] button with hover lift+scale
   */
  _drawLeaderboardTable(scores) {
    const cx = 400, cy = 300;

    // ── Card dimensions ─────────────────────────────────────────────────
    const CARD_W = 460;
    const ROW_H  = 22;
    const VIS_ROWS = Math.max(5, Math.min(20, scores.length || 1));
    const CARD_H = 92 + VIS_ROWS * ROW_H + 64; // header + rows + footer (button)
    const CARD_X = cx - CARD_W / 2;
    const CARD_Y = cy - CARD_H / 2;

    // ── Card backdrop (rounded, shadow, hairline border) ────────────────
    const card = this.add.graphics().setDepth(41).setAlpha(0);
    this._leaderboardObjs.push(card);
    // Drop shadow
    card.fillStyle(0x000000, 0.18);
    card.fillRoundedRect(CARD_X + 2, CARD_Y + 4, CARD_W, CARD_H, 18);
    // Main panel
    card.fillStyle(0xfaf7f1, 0.98);
    card.fillRoundedRect(CARD_X, CARD_Y, CARD_W, CARD_H, 18);
    card.lineStyle(1, 0xb8b0a0, 0.55);
    card.strokeRoundedRect(CARD_X, CARD_Y, CARD_W, CARD_H, 18);
    this.tweens.add({ targets: card, alpha: 1, duration: 240, ease: 'Cubic.Out' });

    // ── Title ───────────────────────────────────────────────────────────
    const title = this.add.text(cx, CARD_Y + 22, '🏆  TOP 20 GLOBAL', {
      fontFamily: FONT, fontSize: '20px', fontStyle: 'bold', color: '#1a1a1a',
    }).setOrigin(0.5, 0).setDepth(42).setAlpha(0);
    this._leaderboardObjs.push(title);
    this.tweens.add({ targets: title, alpha: 1, duration: 240, delay: 60 });

    const subtitle = this.add.text(cx, CARD_Y + 52, 'puntuaciones únicas por nickname', {
      fontFamily: FONT, fontSize: '11px', color: '#9a948a', fontStyle: 'italic',
    }).setOrigin(0.5, 0).setDepth(42).setAlpha(0);
    this._leaderboardObjs.push(subtitle);
    this.tweens.add({ targets: subtitle, alpha: 1, duration: 240, delay: 100 });

    // ── Column header ───────────────────────────────────────────────────
    const HDR_Y    = CARD_Y + 82;
    const COL_RANK  = CARD_X + 36;
    const COL_NICK  = CARD_X + 78;
    const COL_SCORE = CARD_X + CARD_W - 36;

    const hdrStyle = { fontFamily: FONT, fontSize: '10px', color: '#9a948a', fontStyle: 'italic' };
    const hRank  = this.add.text(COL_RANK,  HDR_Y, 'POS',      hdrStyle).setOrigin(0.5, 0).setDepth(42).setAlpha(0);
    const hNick  = this.add.text(COL_NICK,  HDR_Y, 'NICKNAME', hdrStyle).setOrigin(0,   0).setDepth(42).setAlpha(0);
    const hScore = this.add.text(COL_SCORE, HDR_Y, 'SCORE',    hdrStyle).setOrigin(1,   0).setDepth(42).setAlpha(0);
    this._leaderboardObjs.push(hRank, hNick, hScore);
    this.tweens.add({ targets: [hRank, hNick, hScore], alpha: 1, duration: 240, delay: 140 });

    // Hairline divider under header
    const divider = this.add.graphics().setDepth(42).setAlpha(0);
    this._leaderboardObjs.push(divider);
    divider.lineStyle(1, 0xb8b0a0, 0.45);
    divider.beginPath();
    divider.moveTo(CARD_X + 20, HDR_Y + 18);
    divider.lineTo(CARD_X + CARD_W - 20, HDR_Y + 18);
    divider.strokePath();
    this.tweens.add({ targets: divider, alpha: 1, duration: 240, delay: 180 });

    // ── Rows ────────────────────────────────────────────────────────────
    const ROW_START_Y = HDR_Y + 28;

    if (scores.length === 0) {
      const empty = this.add.text(cx, ROW_START_Y + 50,
        'aún no hay puntuaciones registradas.\n¡sé el primero en el ranking!',
        { fontFamily: FONT, fontSize: '13px', color: '#9a948a', align: 'center' }
      ).setOrigin(0.5).setDepth(42).setAlpha(0);
      this._leaderboardObjs.push(empty);
      this.tweens.add({ targets: empty, alpha: 1, duration: 300, delay: 240 });
    } else {
      scores.slice(0, 20).forEach((entry, i) => {
        const y      = ROW_START_Y + i * ROW_H;
        const isTop3 = i < 3;

        // Alternating row tint for readability
        if (i % 2 === 1) {
          const rowBg = this.add.graphics().setDepth(41.5).setAlpha(0);
          this._leaderboardObjs.push(rowBg);
          rowBg.fillStyle(0x000000, 0.025);
          rowBg.fillRoundedRect(CARD_X + 16, y - 2, CARD_W - 32, ROW_H - 2, 4);
          this.tweens.add({
            targets: rowBg, alpha: 1, duration: 200, delay: 200 + i * 22,
          });
        }

        // Top-3 medal accent dot
        if (isTop3) {
          const medalColors = [0xf3c641, 0xc5c5c5, 0xcd8a4a]; // gold/silver/bronze
          const medal = this.add.graphics().setDepth(42).setAlpha(0);
          this._leaderboardObjs.push(medal);
          medal.fillStyle(medalColors[i], 0.92);
          medal.fillCircle(COL_RANK - 18, y + 8, 3.5);
          this.tweens.add({
            targets: medal, alpha: 1, duration: 240, delay: 240 + i * 26,
          });
        }

        const color  = isTop3 ? '#2a4a8a' : '#1a1a1a';
        const fStyle = isTop3 ? 'bold' : 'normal';

        const rk = this.add.text(COL_RANK, y, `${i + 1}`, {
          fontFamily: FONT, fontSize: '13px', color: '#7a7468', fontStyle: fStyle,
        }).setOrigin(0.5, 0).setDepth(42).setAlpha(0);

        const nk = this.add.text(COL_NICK, y, entry.nickname, {
          fontFamily: FONT, fontSize: '14px', color, fontStyle: fStyle,
        }).setOrigin(0, 0).setDepth(42).setAlpha(0);

        const sc = this.add.text(COL_SCORE, y, `${entry.score}`, {
          fontFamily: FONT, fontSize: '14px', color, fontStyle: fStyle,
        }).setOrigin(1, 0).setDepth(42).setAlpha(0);

        this._leaderboardObjs.push(rk, nk, sc);
        this.tweens.add({
          targets:  [rk, nk, sc],
          alpha:    1,
          duration: 220,
          delay:    240 + i * 26,
        });
      });
    }

    // ── CERRAR button (modern lift-hover style) ──────────────────────────
    const closeBtnY = CARD_Y + CARD_H - 32;
    const closeBtn  = this._buildCloseButton(cx, closeBtnY);
    closeBtn.setDepth(43).setAlpha(0);
    this._leaderboardObjs.push(closeBtn);
    this.tweens.add({
      targets: closeBtn, alpha: 1, duration: 260,
      delay:   Math.min(700, 260 + Math.min(scores.length, 20) * 26),
    });
  }

  /**
   * Styled CLOSE button — fillRoundedRect, hover lift+scale, on-press closes.
   */
  _buildCloseButton(cx, cy) {
    const W = 130, H = 34;

    const bg = this.make.graphics({ add: false });
    bg.fillStyle(0x2a2a2a, 0.92);
    bg.fillRoundedRect(-W / 2, -H / 2, W, H, 10);
    bg.lineStyle(1, 0x000000, 0.45);
    bg.strokeRoundedRect(-W / 2, -H / 2, W, H, 10);

    const label = this.add.text(0, 0, '[ CERRAR ]', {
      fontFamily: FONT, fontSize: '13px', fontStyle: 'bold', color: '#ffffff',
    }).setOrigin(0.5);

    const container = this.add.container(cx, cy, [bg, label]);
    container.setInteractive(
      new Phaser.Geom.Rectangle(-W / 2, -H / 2, W, H),
      Phaser.Geom.Rectangle.Contains
    );
    container._baseY     = cy;
    container._baseScale = 1;

    container.on('pointerover', () => this._animateButtonHover(container, true));
    container.on('pointerout',  () => this._animateButtonHover(container, false));
    container.on('pointerdown', () => this._closeLeaderboardOverlay());

    return container;
  }

  _closeLeaderboardOverlay() {
    if (!this._leaderboardOpen) return;
    this._leaderboardOpen = false;
    const objs = [...this._leaderboardObjs];
    this._leaderboardObjs = [];
    this.tweens.add({
      targets: objs, alpha: 0, duration: 180, ease: 'Cubic.Out',
      onComplete: () => objs.forEach(o => { if (o && o.active) o.destroy(); }),
    });
  }

  // ---- Footer --------------------------------------------------------------

  _buildFooter() {
    this.add.text(400, 510,
      'Coloca torres  ·  Detén las oleadas  ·  Protege el cuaderno',
      {
        fontFamily: FONT,
        fontSize:   '12px',
        color:      '#999999',
      }
    ).setOrigin(0.5).setDepth(5);
  }
}
