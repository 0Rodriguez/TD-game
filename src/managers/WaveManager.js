import Enemy from '../components/Enemy.js';

export default class WaveManager {
  /**
   * @param {Phaser.Scene}       scene
   * @param {Phaser.Curves.Path} path
   * @param {number}             baseEnemyHP  Base HP for STANDARD enemies (wave 1)
   */
  constructor(scene, path, baseEnemyHP = 50) {
    this.scene       = scene;
    this.path        = path;
    this.baseEnemyHP = baseEnemyHP;
    this.enemyGroup  = scene.physics.add.group();
    this.isSpawning  = false;
  }

  /**
   * Called on level transition: updates path + base HP and clears surviving enemies.
   */
  reset(path, baseEnemyHP) {
    // Destroy all surviving enemies from the previous level.
    // clear(false, true): don't re-add to displayList, do call child.destroy().
    this.enemyGroup.clear(false, true);
    this.path        = path;
    this.baseEnemyHP = baseEnemyHP;
    this.isSpawning  = false;
  }

  // ---- Public API ----------------------------------------------------------

  startWave(waveNumber) {
    if (this.isSpawning) return;
    this.isSpawning = true;
    this._spawnSequence(5 * waveNumber, 0, waveNumber);
  }

  getActiveEnemies() {
    return this.enemyGroup.getChildren();
  }

  // ---- Internals -----------------------------------------------------------

  _spawnSequence(total, spawned, waveNumber) {
    if (spawned >= total) {
      this.isSpawning = false;
      return;
    }

    this._spawnOne(waveNumber);

    // Delay before the next enemy in the wave
    this.scene.time.delayedCall(
      600,
      () => this._spawnSequence(total, spawned + 1, waveNumber)
    );
  }

  _spawnOne(waveNumber) {
    const startPt = this.path.getPoint(0);
    if (!startPt) return;

    // From wave 2 onwards: ~40 % chance of spawning a fast SCRIBBLE enemy
    const isScribble = waveNumber >= 2 && Math.random() < 0.40;

    // Prefer SVG textures loaded by BootScene; fall back to generated geometry.
    const paperKey   = this.scene.textures.exists('enemy_paper')  ? 'enemy_paper'   : 'enemy-basic';
    const blotKey    = this.scene.textures.exists('enemy_blot')   ? 'enemy_blot'    : 'enemy-scribble';

    // Exponential HP scaling: +18 % resistance per wave.
    // Wave 1: base HP · 1.18^0 = base.  Wave 5: ×1.94.  Wave 10: ×4.13.
    const hpScale = Math.pow(1.18, waveNumber - 1);

    const config = isScribble
      ? {
          health:     Math.floor(this.baseEnemyHP * 0.50 * hpScale),
          speed:      2   + waveNumber * 0.20,
          reward:     5   * waveNumber,
          textureKey: blotKey,
        }
      : {
          health:     Math.floor(this.baseEnemyHP * hpScale),
          speed:      1   + waveNumber * 0.15,
          reward:     10  * waveNumber,
          textureKey: paperKey,
        };

    const enemy = new Enemy(this.scene, this.path, startPt.x, startPt.y, config);
    this.enemyGroup.add(enemy);

    enemy.once('reachedEnd', () => {
      this.scene.events.emit('enemyEscaped');
    });
  }
}
