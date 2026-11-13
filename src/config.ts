import type { Scene } from 'phaser';

/**
 * Size of the game world. Always position things using these coordinates,
 * e.g. the center of the screen is (GAME_WIDTH / 2, GAME_HEIGHT / 2).
 */
export const GAME_WIDTH = 1920;
export const GAME_HEIGHT = 1080;

/**
 * The canvas is drawn at this multiple of the game size (3840x2160), so the
 * game stays sharp on high-DPI (Retina) screens and large monitors.
 */
export const RENDER_SCALE = 2;

/**
 * Call this at the start of every scene's create(). It zooms the main camera
 * so the scene can use 1920x1080 coordinates on the larger canvas.
 *
 * Note: use pointer.worldX / pointer.worldY for mouse/touch positions;
 * pointer.x / pointer.y are in canvas pixels (3840x2160).
 */
export function setupCamera(scene: Scene): void {
  scene.cameras.main.setOrigin(0, 0).setZoom(RENDER_SCALE);
}
