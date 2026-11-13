import { AUTO, Game, Scale, type Types } from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE } from './config';
import { StartScene } from './scenes/StartScene';

const config: Types.Core.GameConfig = {
  type: AUTO,
  parent: 'game-container',
  backgroundColor: '#FFB6B5',
  scale: {
    mode: Scale.FIT,
    autoCenter: Scale.CENTER_BOTH,
    // Canvas is rendered at RENDER_SCALE x the game size for sharpness;
    // scenes still use 1920x1080 coordinates (see setupCamera in config.ts).
    width: GAME_WIDTH * RENDER_SCALE,
    height: GAME_HEIGHT * RENDER_SCALE,
  },
  scene: [StartScene],
};

new Game(config);
