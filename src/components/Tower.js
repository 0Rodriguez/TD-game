import Phaser from 'phaser';

// Upgrade cost per target level — index = level you're paying TO reach.
// Level 1 is the placement cost; from 2 and 3 the player pays to upgrade.
const UPGRADE_COSTS = [null, null, 75, 150];

// Stat multipliers applied per upgrade step.
const DAMAGE_MULT_PER_LEVEL    = 1.40; // +40 % damage
const FIRE_RATE_DIV_PER_LEVEL  = 1.25; // 25 % faster (fireRate is interval ms)

export default class Tower extends Phaser.GameObjects.Container {
  /**
   * @param {Phaser.Scene} scene
   * @param {number}       x
   * @param {number}       y
   * @param {{ type, cost, range, fireRate, damage, bulletSpeed }} config
   *   type: 'BASIC' (default) | 'INK'
   */
  constructor(scene, x, y, config = {}) {
    super(scene, x, y);

    this.config   = config;
    this.type     = config.type ?? 'BASIC';
    this.nextFire = 0;

    // Upgrade state — each tower starts at level 1, can reach level 3.
    this.level    = 1;
    this.maxLevel = 3;

    // BASIC pencil SVG has its tip pointing UP (−π/2).
    // Adding +π/2 in update() rotates it so the tip aligns with the firing angle.
    // INK cannon Graphics already points RIGHT (0) → no offset needed.
    this._aimOffset = this.type === 'BASIC' ? Math.PI / 2 : 0;

    this._buildVisuals(scene);
    this.setDepth(6);

    this.setInteractive(
      new Phaser.Geom.Circle(0, 0, 18),
      Phaser.Geom.Circle.Contains
    );
    // NOTE: the modern blue-ink range indicator is owned by TowerManager —
    // it registers its own pointerover/pointerout handlers on every placed
    // tower.  The old dashed pencil _ring is kept hidden for now (could be
    // reused for future visual states without rebuilding the graphics).

    scene.add.existing(this);
  }

  // ---- Upgrade system ------------------------------------------------------

  /**
   * Returns the gold cost to upgrade this tower to its next level, or null
   * if it's already at max.
   */
  get upgradeCost() {
    return this.level >= this.maxLevel ? null : UPGRADE_COSTS[this.level + 1];
  }

  get canUpgrade() {
    return this.level < this.maxLevel;
  }

  /**
   * Upgrades the tower by one level: boosts damage +40 %, fire rate +25 %.
   * Refreshes the rank halo and applies a soft "level up" animation.
   * @returns {boolean} true if upgraded, false if already at max.
   */
  upgrade() {
    if (!this.canUpgrade) return false;

    this.level += 1;
    this.config.damage   = Math.round(this.config.damage * DAMAGE_MULT_PER_LEVEL);
    this.config.fireRate = Math.round(this.config.fireRate / FIRE_RATE_DIV_PER_LEVEL);
    // Cumulative scale: +10 % per level above 1 → lv2 = 1.10, lv3 = 1.21
    const targetScale = Math.pow(1.10, this.level - 1);

    // Smooth scale bump with a tiny overshoot pulse — feels juicy without
    // being chaotic.  Halo is rebuilt mid-animation.
    this.scene.tweens.killTweensOf(this);
    this.scene.tweens.add({
      targets:  this,
      scaleX:   targetScale * 1.08,
      scaleY:   targetScale * 1.08,
      duration: 140,
      ease:     'Cubic.Out',
      yoyo:     true,
      hold:     30,
      onYoyo:   () => this._refreshRankHalo(),
      onComplete: () => {
        this.setScale(targetScale);
        this._refreshRankHalo();
      },
    });

    return true;
  }

  /**
   * Rebuilds the rank halo Graphics to match `this.level`.
   * Level 1: no halo.  Level 2: thin amber ring.  Level 3: thicker gold + dots.
   */
  _refreshRankHalo() {
    if (this._rankHalo) {
      this._rankHalo.destroy();
      this._rankHalo = null;
    }
    if (this.level <= 1) return;

    const g = this.scene.make.graphics({ add: false });

    if (this.level === 2) {
      g.lineStyle(1.6, 0xd49a3a, 0.85);
      g.strokeCircle(0, 0, 18);
    } else { // level 3
      g.lineStyle(2.2, 0xe6b14a, 0.92);
      g.strokeCircle(0, 0, 19);
      g.fillStyle(0xe6b14a, 0.85);
      // Three tiny accent dots at the cardinal corners
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + i * (Math.PI * 2 / 3);
        g.fillCircle(Math.cos(a) * 19, Math.sin(a) * 19, 1.6);
      }
    }

    // Add at index 0 so it sits BEHIND the tower visuals (ring, base, cannon).
    this._rankHalo = g;
    this.addAt(g, 0);
  }

  // ---- Visual construction -------------------------------------------------

  _buildVisuals(scene) {
    this._ring = this._makeRing(scene);

    if (this.type === 'INK') {
      const base   = this._makeInkBase(scene);
      this._cannon = this._makeInkCannon(scene);
      this.add([this._ring, base, this._cannon]);

    } else if (scene.textures.exists('pencil_tower')) {
      // BASIC — use SVG pencil sprite. A single Image replaces base + cannon.
      // Origin (0.5, 0.80): pivot sits ~32 px below the tip (near the ferrule),
      // so the pencil tip sweeps widely when rotated to aim at enemies.
      const pencil = scene.make.image({ key: 'pencil_tower', add: false });
      pencil.setOrigin(0.5, 0.80);
      this._cannon = pencil; // shared ref → update() calls setRotation() on this
      this.add([this._ring, pencil]);

    } else {
      // BASIC fallback — hand-drawn Graphics (used when SVG hasn't loaded yet)
      const base    = this._makeBase(scene);
      this._cannon  = this._makeCannon(scene);
      this.add([this._ring, base, this._cannon]);
    }
  }

  // --- Shared ring -----------------------------------------------------------

  /** Dashed pencil circle showing attack range — hidden until hover. */
  _makeRing(scene) {
    const g      = scene.make.graphics({ add: false });
    const r      = this.config.range;
    const dashes = 32;
    const step   = (Math.PI * 2) / dashes;
    const color  = this.type === 'INK' ? 0x2233aa : 0x555555;

    g.lineStyle(1, color, 0.50);

    for (let i = 0; i < dashes; i += 2) {
      const a0 = i * step;
      const a1 = a0 + step;
      g.beginPath();
      g.arc(0, 0, r, a0, a1, false, 64);
      g.strokePath();
    }

    g.setVisible(false);
    return g;
  }

  // --- BASIC visuals ---------------------------------------------------------

  /** Hand-drawn circular base — pencil-on-paper aesthetic. */
  _makeBase(scene) {
    const g = scene.make.graphics({ add: false });

    g.fillStyle(0xeee8dc, 0.85);
    g.fillCircle(0, 0, 15);

    g.lineStyle(0.7, 0x666666, 0.14);
    for (let y = -13; y <= 13; y += 3) {
      const half = Math.sqrt(Math.max(0, 15 * 15 - y * y));
      g.beginPath(); g.moveTo(-half + 1, y); g.lineTo(half - 1, y); g.strokePath();
    }

    g.lineStyle(1.5, 0x2a2a2a, 0.90);
    g.strokeCircle(0, 0, 15);
    g.lineStyle(0.7, 0x444444, 0.35);
    g.strokeCircle(0.4, -0.4, 14.7);
    g.lineStyle(0.8, 0x444444, 0.40);
    g.strokeCircle(0, 0, 8);
    g.fillStyle(0x2a2a2a, 0.85);
    g.fillCircle(0, 0, 2);

    return g;
  }

  /** Mechanical-pencil barrel — extends RIGHT from (0,0), rotates around tower center. */
  _makeCannon(scene) {
    const g = scene.make.graphics({ add: false });

    g.lineStyle(2, 0x2a2a2a, 0.88);
    g.beginPath(); g.moveTo(2, 0); g.lineTo(22, 0); g.strokePath();
    g.lineStyle(1, 0x555555, 0.38);
    g.beginPath(); g.moveTo(2, -2); g.lineTo(22, -2); g.strokePath();
    g.beginPath(); g.moveTo(2,  2); g.lineTo(22,  2); g.strokePath();
    g.fillStyle(0x2a2a2a, 0.80);
    g.fillRect(19, -2.5, 4, 5);

    return g;
  }

  // --- INK visuals -----------------------------------------------------------

  /**
   * Top-down ink-bottle base: dark ink pool inside a paper-white rim,
   * with a faint highlight and hand-drawn wobbly circle.
   */
  _makeInkBase(scene) {
    const g = scene.make.graphics({ add: false });

    // Paper rim
    g.fillStyle(0xe4dfd4, 0.88);
    g.fillCircle(0, 0, 15);

    // Deep ink fill
    g.fillStyle(0x08083a, 0.92);
    g.fillCircle(0, 0, 12);

    // Ink depth shimmer (lighter core reflection)
    g.fillStyle(0x1a1a88, 0.30);
    g.fillCircle(-2, -3, 7);

    // Specular highlight
    g.fillStyle(0xffffff, 0.16);
    g.fillCircle(-4, -4, 4);

    // Hand-drawn outer rim
    g.lineStyle(1.5, 0x2a2a2a, 0.92);
    g.strokeCircle(0, 0, 15);
    g.lineStyle(0.8, 0x444444, 0.38);
    g.strokeCircle(-0.4, 0.4, 14.6); // slight wobble

    // Inner ink-surface ring
    g.lineStyle(1, 0x2233bb, 0.45);
    g.strokeCircle(0, 0, 11);

    // Nib hole at center
    g.fillStyle(0x2a2a2a, 0.70);
    g.fillCircle(0, 0, 2.5);

    return g;
  }

  /**
   * Fountain-pen nib: tapered from a barrel base to a fine writing point.
   * Extends RIGHT from (0,0); rotates around tower center.
   */
  _makeInkCannon(scene) {
    const g = scene.make.graphics({ add: false });

    // Barrel body
    g.fillStyle(0x0d0d3a, 0.95);
    g.fillRect(2, -3, 12, 6);
    g.lineStyle(1.5, 0x2233aa, 0.80);
    g.strokeRect(2, -3, 12, 6);

    // Taper / nib section (triangle pointing right)
    g.fillStyle(0x1a1a55, 0.90);
    g.fillTriangle(14, -3, 23, 0, 14, 3);
    g.lineStyle(1.2, 0x3344cc, 0.70);
    g.beginPath(); g.moveTo(14, -3); g.lineTo(23, 0); g.lineTo(14, 3); g.closePath(); g.strokePath();

    // Nib slit line
    g.lineStyle(0.8, 0x8899ee, 0.65);
    g.beginPath(); g.moveTo(15, 0); g.lineTo(22, 0); g.strokePath();

    // Ink drop gleam on barrel
    g.fillStyle(0x4455cc, 0.20);
    g.fillRect(4, -2, 6, 4);

    return g;
  }

  // ---- AI / Targeting -------------------------------------------------------

  /**
   * Main update — called every frame by TowerManager.
   * @param {number}   time    - Game clock in ms
   * @param {object[]} enemies - Live enemy array
   */
  update(time, enemies) {
    const target = this._findNearest(enemies);
    if (!target) return;

    const angle = Phaser.Math.Angle.Between(this.x, this.y, target.x, target.y);
    // _aimOffset aligns the sprite's "forward" axis with the computed firing angle:
    //   BASIC  pencil SVG   → tip points UP  → +π/2 rotates it to face `angle`
    //   INK    cannon Gfx   → nib points RIGHT → 0 offset (already aligned)
    this._cannon.setRotation(angle + this._aimOffset);

    if (time >= this.nextFire) {
      this._fire(target);
      this.nextFire = time + this.config.fireRate;
    }
  }

  /**
   * O(n) scan — initialises minDist = config.range as a built-in range gate.
   * Distance: d = √((Δx)²+(Δy)²) via Phaser.Math.Distance.Between.
   * @returns {object|null}
   */
  _findNearest(enemies) {
    let nearest = null;
    let minDist = this.config.range;

    for (const e of enemies) {
      if (!e.active) continue;
      const d = Phaser.Math.Distance.Between(this.x, this.y, e.x, e.y);
      if (d < minDist) { minDist = d; nearest = e; }
    }

    return nearest;
  }

  // ---- Projectiles ----------------------------------------------------------

  /** Dispatch to type-specific fire method. */
  _fire(target) {
    if (this.type === 'INK') {
      this._fireInk(target);
    } else {
      this._fireBasic(target);
    }
  }

  /**
   * BASIC: pencil-bullet Image (or Arc fallback) fired toward the target.
   *
   * Key design decisions:
   * ① `firingAngle` is computed FRESH — never from `this._cannon.rotation`,
   *    which has `_aimOffset` (+π/2) baked in and would spawn the bullet
   *    perpendicular to the intended trajectory.
   * ② The bullet sprite is added to the SCENE (not to the Container), so its
   *    `x` and `y` live in global scene space — no container-local offset.
   * ③ `setOrigin(0.5, 0.5)` keeps the Image pivot centered, preventing any
   *    rotation-induced positional drift.
   * ④ `onComplete` uses `target.x / target.y` (enemy's current world coords)
   *    rather than `bullet.x / bullet.y` — breaks all container inheritance
   *    and gives the impact mark the true enemy position.
   */
  _fireBasic(target) {
    // ① Fresh angle — independent of _cannon.rotation offset
    const firingAngle = Phaser.Math.Angle.Between(this.x, this.y, target.x, target.y);

    // Muzzle: 30 px along the firing direction from the tower center.
    // (Pencil SVG origin is 32 px from tip; 30 px keeps the spawn inside the tip.)
    const muzzleX = this.x + Math.cos(firingAngle) * 30;
    const muzzleY = this.y + Math.sin(firingAngle) * 30;

    let bullet;

    if (this.scene.textures.exists('bullet_pencil')) {
      // ② Pencil bullet — added directly to scene, NOT to this Container
      bullet = this.scene.add.image(muzzleX, muzzleY, 'bullet_pencil');
      // ③ Centered pivot; no scale/rotation-induced drift
      bullet.setOrigin(0.5, 0.5);
      // Bullet SVG tip points UP (−π/2); rotating by firingAngle + π/2 aims the
      // tip exactly toward the target for the entire tween journey.
      bullet.setRotation(firingAngle + Math.PI / 2);
      bullet.setDepth(8);
    } else {
      // Fallback Arc for when SVG hasn't loaded
      bullet = this.scene.add.arc(muzzleX, muzzleY, 2.5, 0, 360, false, 0x2a2a2a, 0.85);
      bullet.setStrokeStyle(1, 0x666666, 0.45);
      bullet.setOrigin(0.5, 0.5);
      bullet.setDepth(8);
    }

    const dist = Phaser.Math.Distance.Between(muzzleX, muzzleY, target.x, target.y);
    const ms   = (dist / this.config.bulletSpeed) * 1000;

    this.scene.tweens.add({
      targets:  bullet,
      x:        target.x,  // ② global scene coordinate
      y:        target.y,
      duration: ms,
      ease:     'Linear',
      onComplete: () => {
        // ④ target world coords — enemy's live position when bullet arrives
        this._drawImpactMark(target.x, target.y);
        if (target?.active) target.takeDamage(this.config.damage);
        bullet.destroy();
      },
    });
  }

  /**
   * INK: dark ink blob → applies slow + reduced damage on arrival.
   *
   * Root-cause of old drift bug:
   * `setRotation(a)` combined with scaleX ≠ scaleY made Phaser apply a
   * non-uniform scale in rotated local axes, displacing the visual center
   * of the Arc away from (blob.x, blob.y) in a direction dependent on `a`.
   *
   * Fix:
   * - Remove `setRotation` — a full circle (0→360°) is rotationally symmetric;
   *   visual rotation is meaningless and only introduces the pivot mismatch.
   * - Replace non-uniform (scaleX=1.35, scaleY=0.68) wobble with a UNIFORM
   *   pulse (scaleX = scaleY). Uniform scale keeps the center pinned at the
   *   Arc's origin regardless of scale magnitude or rotation.
   * - Explicit `setOrigin(0.5, 0.5)` guarantees the Arc's pivot is centred.
   * - Single movement tween — no concurrent tween conflict.
   */
  _fireInk(target) {
    const a       = this._cannon.rotation;
    const muzzleX = this.x + Math.cos(a) * 22; // world coords: Container.x + offset
    const muzzleY = this.y + Math.sin(a) * 22;

    const blob = this.scene.add.arc(muzzleX, muzzleY, 4.5, 0, 360, false, 0x08083a, 0.90);
    blob.setStrokeStyle(1.5, 0x2233bb, 0.55);
    blob.setDepth(8);
    // Pivot at visual centre — uniform scale pulse cannot shift the arc's world position
    blob.setOrigin(0.5, 0.5);

    const dist = Phaser.Math.Distance.Between(muzzleX, muzzleY, target.x, target.y);
    const ms   = (dist / this.config.bulletSpeed) * 1000;

    // Uniform pulse — scaleX === scaleY so the pivot offset is symmetric in every
    // direction; no net positional drift regardless of firing angle.
    this.scene.tweens.add({
      targets: blob, scaleX: 1.25, scaleY: 1.25,
      yoyo: true, repeat: -1, duration: 120, ease: 'Sine.InOut',
    });

    // Independent movement tween — touches only x/y, no conflict with scale tween
    this.scene.tweens.add({
      targets:    blob,
      x:          target.x,  // target world X (enemy's scene-space coordinate)
      y:          target.y,  // target world Y
      duration:   ms,
      ease:       'Linear',
      onComplete: () => {
        // target.x/y: enemy's live world position — breaks container inheritance
        this._drawInkSplash(target.x, target.y);
        if (target?.active) {
          target.takeDamage(this.config.damage);
          if (target.applySlow) target.applySlow(0.5, 2000);
        }
        blob.destroy();
      },
    });
  }

  // ---- Impact FX ------------------------------------------------------------

  /**
   * Pencil-mark X at BASIC bullet impact — fades out in ~250 ms.
   *
   * The Graphics is positioned at (wx, wy) via setPosition().
   * All draw commands use LOCAL (0, 0) coordinates so they render
   * exactly at the enemy's world position without container inheritance.
   */
  _drawImpactMark(wx, wy) {
    const gfx = this.scene.add.graphics().setDepth(9);
    gfx.setPosition(wx, wy); // anchor at world position
    const r = 4.5;

    gfx.lineStyle(1.5, 0x2a2a2a, 0.82);
    gfx.beginPath(); gfx.moveTo(-r, -r); gfx.lineTo(r,  r); gfx.strokePath();
    gfx.beginPath(); gfx.moveTo( r, -r); gfx.lineTo(-r, r); gfx.strokePath();
    gfx.lineStyle(1, 0x666666, 0.32);
    gfx.strokeCircle(0, 0, r + 2);

    this.scene.tweens.add({
      targets: gfx, alpha: 0, duration: 250, ease: 'Cubic.Out',
      onComplete: () => gfx.destroy(),
    });
  }

  /**
   * Ink splatter at INK bullet impact — expands and fades.
   *
   * Root-cause of old displacement bug:
   * When Graphics is at world (0,0) and circles are drawn at (wx, wy),
   * scaling (scaleX: 1.9) multiplies the draw coordinates away from (0,0),
   * not from the intended center (wx, wy).
   *
   * Fix: place the Graphics AT (wx, wy) via setPosition(), draw all blobs
   * at local (0, 0) / small offsets.  When scaleX/Y tweens fire, expansion
   * happens around the Graphics' own position (wx, wy). ✓
   */
  _drawInkSplash(wx, wy) {
    const gfx = this.scene.add.graphics().setDepth(9);
    gfx.setPosition(wx, wy); // world anchor — scale expansion centres here

    gfx.fillStyle(0x08083a, 0.72);
    gfx.fillCircle(0,  0,  7);   // main blob at local origin = world (wx, wy)

    gfx.fillStyle(0x1122aa, 0.42);
    gfx.fillCircle(-5, -3, 5);   // satellite drops in local space
    gfx.fillCircle( 5,  3, 4);
    gfx.fillCircle(-2,  7, 3);
    gfx.fillCircle( 4, -6, 2.5);

    this.scene.tweens.add({
      targets: gfx, alpha: 0, scaleX: 1.9, scaleY: 1.9,
      duration: 380, ease: 'Cubic.Out',
      onComplete: () => gfx.destroy(),
    });
  }

  // ---- Economy -------------------------------------------------------------

  /** Gold refund when this tower is sold (70 % of build cost). */
  get sellPrice() {
    return Math.floor(this.config.cost * 0.7);
  }
}
