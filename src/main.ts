import { AUTO, Game, Scale, type Types } from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE } from './config';
import { inputManager } from './input/InputManager';
import { AdventureScene } from './scenes/AdventureScene';
import { DetectiveScene } from './scenes/DetectiveScene';
import { KomedieScene } from './scenes/KomedieScene';
import { GeschiedenisScene } from './scenes/GeschiedenisScene';
import { MenuScene } from './scenes/MenuScene';
import { FantasyScene } from './scenes/FantasyScene';

const config: Types.Core.GameConfig = {
  type: AUTO,
  parent: 'game-container',
  // Black, so switching between scenes (and loading) looks like a fade through black.
  backgroundColor: '#000000',
  scale: {
    mode: Scale.FIT,
    autoCenter: Scale.CENTER_BOTH,
    // Canvas is rendered at RENDER_SCALE x the game size for sharpness;
    // scenes still use GAME_WIDTH x GAME_HEIGHT coordinates (see config.ts).
    width: GAME_WIDTH * RENDER_SCALE,
    height: GAME_HEIGHT * RENDER_SCALE,
  },
  // The first scene in the list starts first.
  scene: [MenuScene, GeschiedenisScene, DetectiveScene, KomedieScene, FantasyScene, AdventureScene],
};

const game = new Game(config);

// Mouse/trackpad or tilt controller (ESP32), for all scenes. See src/input/InputManager.ts.
inputManager.attach(game);
