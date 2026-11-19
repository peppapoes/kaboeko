import type { GameObjects, Scene } from 'phaser';
import { RENDER_SCALE } from './config';

/*
 * Shared bits of interface used on several screens.
 */

const PRESS_TEXT = 'druk op een knop om het spel te starten';
const PRESS_FONT = 'Oswald';

/**
 * Blinking "druk op een knop om het spel te starten" text, in Oswald.
 * Waits for the font to be loaded, otherwise the text is drawn in a fallback font.
 */
export async function addPressButtonText(
  scene: Scene,
  x: number,
  y: number,
  options: { depth?: number; delay?: number; fontSize?: number } = {},
): Promise<GameObjects.Text | undefined> {
  const { depth = 0, delay = 0, fontSize = 34 } = options;

  await document.fonts.load(`500 ${fontSize}px ${PRESS_FONT}`);
  // The scene may have been left while the font was loading.
  if (!scene.sys.isActive()) return undefined;

  const text = scene.add
    .text(x, y, PRESS_TEXT, {
      fontFamily: PRESS_FONT,
      fontStyle: '500',
      fontSize: `${fontSize}px`,
      color: '#FFFFFF',
      resolution: RENDER_SCALE,
    })
    .setOrigin(0.5)
    .setDepth(depth)
    .setAlpha(0);

  scene.tweens.add({
    targets: text,
    alpha: { from: 0.25, to: 1 },
    delay,
    duration: 800,
    yoyo: true,
    repeat: -1,
    ease: 'Sine.InOut',
  });
  return text;
}
