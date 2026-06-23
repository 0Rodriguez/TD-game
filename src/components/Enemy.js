import Phaser from 'phaser';

const BAR_W  = 32;
const BAR_H  = 4;
const BAR_DY = -24; // px above sprite center

// Texture keys that come from SVG assets (spin freely rather than facing path)
const SVG_TEXTURE_KEYS = ['enemy_paper', 'enemy_blot'];

export default class Enemy extends Phaser.GameObjects.PathFollower {
  /**
   * @param {Phaser.Scene}       scene
   * @param {Phaser.Curves.Path} path
   * @param {number}             x
   * @param {number}             y
   * @param {{ health, speed, reward, textureKey }} config
   */
  constructor(scene, path, x, y, config = {}) {
    super(scene, path, x, y, config.textureKey ?? 'enemy-basic');
    this.setOrigin(0.5, 0.5);
    this.setDepth(5);

    this.maxHealth     = config.health ?? 100;
    this.health        = this.maxHealth;
    this.speed         = config.speed  ?? 1;
    this.reward        = config.reward ?? 10;
    this.speedModifier = 1.0;

    // ── Spin animation for SVG-based enemies ──────────────────────────────────
    // Paper ball: slow rolling tumble. Ink blot: faster chaotic spin.
    // SVG enemies don't orient to path direction — they spin freely.
    this._isSvgEnemy = SVG_TEXTURE_KEYS.includes(config.textureKey ?? '');
    this._spinAccum  = 0;
    this._spinSpeed  = this._isSvgEnemy
      ? (config.textureKey === 'enemy_blot' ? 0.055 : 0.028)
      : 0;
    // ──────────────────────────────────────────────────────────────────────────

    this._hpGfx    = scene.add.graphics().setDepth(15);
    this._slowGfx  = null;
    this._slowTimer = null;

    this._redrawHpBar();
    scene.add.existing(this);

    this.startFollow({
      duration:     25000 / this.speed,
      // SVG enemies spin on their own; non-SVG enemies face the path direction
      rotateToPath: !this._isSvgEnemy,
    });

    this.pathTween.once('complete', () => {
      this.emit('reachedEnd', this);
      this._safeDestroy();
    });
  }

  // ---- Health bar ----------------------------------------------------------

  _redrawHpBar() {
    const ratio = Phaser.Math.Clamp(this.health / this.maxHealth, 0, 1);
    const fillW = Math.floor(BAR_W * ratio);
    const color = ratio > 0.5 ? 0x4a8a4a : ratio > 0.25 ? 0x8a7020 : 0x8a3a3a;

    this._hpGfx.clear();

    this._hpGfx.fillStyle(0xe0dcd4, 0.92);
    this._hpGfx.fillRect(-BAR_W / 2, BAR_DY, BAR_W, BAR_H);
    this._hpGfx.lineStyle(0.8, 0x555555, 0.65);
    this._hpGfx.strokeRect(-BAR_W / 2, BAR_DY, BAR_W, BAR_H);

    if (fillW > 0) {
      this._hpGfx.fillStyle(color, 0.82);
      this._hpGfx.fillRect(-BAR_W / 2, BAR_DY, fillW, BAR_H);
    }
  }

  // ---- Status effects -------------------------------------------------------

  applySlow(factor, duration) {
    if (!this.active) return;

    this.speedModifier = factor;
    this.pathTween.timeScale = factor;

    this._showSlowOverlay();

    this._slowTimer?.remove();
    this._slowTimer = this.scene.time.delayedCall(duration, () => {
      if (!this.active) return;
      this.speedModifier       = 1.0;
      this.pathTween.timeScale = 1.0;
      this._clearSlowOverlay();
    });
  }

  _showSlowOverlay() {
    if (!this._slowGfx) {
      this._slowGfx = this.scene.add.graphics().setDepth(7);
    }
    this._slowGfx.setVisible(true);
    this._slowGfx.clear();

    this._slowGfx.fillStyle(0x1133aa, 0.48);
    this._slowGfx.fillEllipse(0, 0, 28, 22);
    this._slowGfx.fillStyle(0x0a2288, 0.32);
    this._slowGfx.fillCircle(-7, 5, 5);
    this._slowGfx.fillCircle(7, 6, 4);
    this._slowGfx.fillCircle(1, -7, 3.5);
  }

  _clearSlowOverlay() {
    this._slowGfx?.setVisible(false);
  }

  // ---- Combat ---------------------------------------------------------------

  takeDamage(amount) {
    this.health -= amount;

    this.setTint(0xffffff);
    this.scene.time.delayedCall(80, () => { if (this.active) this.clearTint(); });

    this._redrawHpBar();

    if (this.health <= 0) {
      this.scene.events.emit('enemyKilled', this.reward, this.x, this.y);
      this._safeDestroy();
    }
  }

  // ---- Per-frame ------------------------------------------------------------

  preUpdate(time, delta) {
    super.preUpdate(time, delta); // PathFollower updates position (and rotation if rotateToPath)

    // Continuous spin for SVG enemies.
    // Since rotateToPath is false for these, PathFollower never touches this.rotation,
    // so _spinAccum accumulates cleanly and drives the full rotation each frame.
    if (this._spinSpeed > 0) {
      this._spinAccum += this._spinSpeed;
      this.setRotation(this._spinAccum);
    }

    if (this._hpGfx?.active) {
      this._hpGfx.setPosition(this.x, this.y);
    }
    if (this._slowGfx?.active && this._slowGfx.visible) {
      this._slowGfx.setPosition(this.x, this.y);
    }
  }

  // ---- Lifecycle ------------------------------------------------------------

  _safeDestroy() {
    if (this.active) this.destroy();
  }

  destroy(fromScene) {
    this._hpGfx?.destroy();
    this._hpGfx = null;
    this._slowGfx?.destroy();
    this._slowGfx = null;
    this._slowTimer?.remove();
    this._slowTimer = null;
    super.destroy(fromScene);
  }
}
