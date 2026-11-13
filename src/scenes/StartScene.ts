import { Scene } from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE, setupCamera } from '../config';

export class StartScene extends Scene {
  constructor() {
    super('StartScene');
  }

  create() {
    setupCamera(this);

    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'Het land van Kaboeko', {
        fontFamily: 'Arial',
        fontSize: '32px',
        color: '#03314E',
        resolution: RENDER_SCALE,
      })
      .setOrigin(0.5);
  }
}
