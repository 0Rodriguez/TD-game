import Phaser from 'phaser';
import BootScene from './scenes/BootScene.js';
import MenuScene from './scenes/MenuScene.js';
import GameScene from './scenes/GameScene.js';

const config = {
  type: Phaser.WEBGL,
  parent: 'game',
  width: 800,
  height: 600,
  backgroundColor: '#faf8f5',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  // Flow: BootScene (preload SVGs) → MenuScene (title screen) → GameScene
  scene: [BootScene, MenuScene, GameScene],
};

new Phaser.Game(config);
