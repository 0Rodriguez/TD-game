import Phaser from 'phaser';

// Vite resolves these to final public URLs at build time (?url import).
import pencilTowerUrl  from '../assets/tower-pencil.svg?url';
import bulletPencilUrl from '../assets/bullet-pencil.svg?url';
import enemyPaperUrl   from '../assets/enemy-paper.svg?url';
import enemyBlotUrl    from '../assets/enemy-blot.svg?url';

export default class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  init() {}

  preload() {
    // Tower + projectile sprites
    this.load.svg('pencil_tower',  pencilTowerUrl,  { width: 40, height: 40 });
    this.load.svg('bullet_pencil', bulletPencilUrl, { width: 10, height: 22 });

    // Enemy sprites (replace procedural-geometry fallbacks)
    this.load.svg('enemy_paper', enemyPaperUrl, { width: 32, height: 32 });
    this.load.svg('enemy_blot',  enemyBlotUrl,  { width: 32, height: 32 });
  }

  create() {
    // All assets loaded → go to title screen
    this.scene.start('MenuScene');
  }
}
