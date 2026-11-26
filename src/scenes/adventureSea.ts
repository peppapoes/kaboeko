import { GameObjects, Math as PMath, Scene } from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';

/*
 * The sea of the adventure game: layers of "paper" waves that come towards the
 * screen. Each wave has a progress p: 0 = at the horizon, 1 = off the bottom of
 * the screen. A wave that reaches 1 comes up again at the back.
 */

export const SEA = {
  sky: '#A7E6F1',
  dark: '#41A1C5',
  light: '#5EC2E7',
  /** Where the farthest waves come up, and where the nearest ones disappear. */
  horizon: 470,
  end: 1440,
  /** Number of waves (even, so the two blues keep alternating). */
  count: 8,
  /** Waves are drawn at depth SEA.depth + p (nearer = on top). */
  depth: 10,
};

/** A wave shape repeats every this many pixels, so it can slide sideways forever. */
const PERIOD = 960;
const TEXTURE = {
  width: GAME_WIDTH + PERIOD,
  height: 560,
  /** Room above the middle line for the crests and their shadow. */
  top: 70,
  /** Texture pixels per game pixel (RENDER_SCALE would be wider than the GPU allows). */
  resolution: 1.4,
};

/** Two different wave shapes: [height, repeats per period, shift] for each sine. */
const SHAPES: [number, number, number][][] = [
  [[30, 1, 0], [9, 2, 1.3]],
  [[24, 1, 2.6], [12, 2, 4.1]],
];

/** Screen height of the middle line of a wave at progress p (perspective: faster when nearer). */
export function waveY(p: number): number {
  return SEA.horizon + (SEA.end - SEA.horizon) * Math.pow(p, 1.6);
}

interface Wave {
  image: GameObjects.Image;
  p: number;
  /** Sideways shift, so the waves don't line up. */
  phase: number;
}

export class Sea {
  private waves: Wave[] = [];

  constructor(scene: Scene) {
    scene.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, Number.parseInt(SEA.sky.slice(1), 16)).setOrigin(0).setDepth(0);

    for (let i = 0; i < SEA.count; i++) {
      const key = makeWaveTexture(scene, i % 2 === 0 ? SEA.dark : SEA.light, Math.floor(i / 2) % SHAPES.length);
      const image = scene.add.image(0, 0, key).setOrigin(0, TEXTURE.top / TEXTURE.height);
      this.waves.push({ image, p: i / SEA.count, phase: (i * 347) % PERIOD });
    }
    this.update(0, 0);
  }

  /**
   * Move the waves closer by `step`; boatX = how far the boat has gone sideways.
   * Returns the waves that just started again at the back.
   */
  update(step: number, boatX: number): number[] {
    const restarted: number[] = [];
    this.waves.forEach((wave, i) => {
      wave.p += step;
      if (wave.p >= 1) {
        wave.p -= 1;
        restarted.push(i);
      }
      // Nearer waves slide further when the boat steers.
      const slide = boatX * (0.15 + wave.p) + wave.phase;
      const left = -(((slide % PERIOD) + PERIOD) % PERIOD);
      wave.image
        .setPosition(left, this.waveTop(i))
        .setScale(1 / TEXTURE.resolution, (0.45 + wave.p * 0.75) / TEXTURE.resolution)
        .setDepth(SEA.depth + wave.p);
    });
    return restarted;
  }

  progress(index: number): number {
    return this.waves[index].p;
  }

  /** Height of a wave's middle line right now. A new wave comes up from behind the one in front of it. */
  waveTop(index: number): number {
    const { p } = this.waves[index];
    const rising = 1 - PMath.Clamp(p * SEA.count, 0, 1);
    return waveY(p) + rising * 55;
  }
}

/** One wave: a wavy top edge with a soft shadow, like a layer of cut paper. Drawn once. */
function makeWaveTexture(scene: Scene, color: string, shape: number): string {
  const key = `av-wave-${color.slice(1)}-${shape}`;
  if (scene.textures.exists(key)) return key;

  const { width, height, top, resolution } = TEXTURE;
  const texture = scene.textures.createCanvas(key, Math.round(width * resolution), Math.round(height * resolution));
  if (!texture) return key;
  const ctx = texture.getContext();
  ctx.scale(resolution, resolution);

  ctx.beginPath();
  ctx.moveTo(0, height);
  for (let x = 0; x <= width; x += 8) {
    const y = SHAPES[shape].reduce(
      (sum, [amount, repeats, shift]) => sum + amount * Math.sin((x / PERIOD) * Math.PI * 2 * repeats + shift),
      top,
    );
    ctx.lineTo(x, y);
  }
  ctx.lineTo(width, height);
  ctx.closePath();

  ctx.shadowColor = 'rgba(10, 60, 85, 0.45)';
  ctx.shadowBlur = 9 * resolution;
  ctx.shadowOffsetY = -2 * resolution;
  ctx.fillStyle = color;
  ctx.fill();
  texture.refresh();
  return key;
}
