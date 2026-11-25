/*
 * Spells for the fantasie minigame: the movements the wizard (player 2) has
 * to copy with the wand, and the logic that checks whether they followed it.
 *
 * A spell is a shape (a line through a few points). On screen it becomes a
 * row of dots; the wand has to pass the dots in order, from start to end.
 */

export interface Point {
  x: number;
  y: number;
}

export interface SpellDef {
  /** Shown above the shape while it has to be traced (\n = new line). */
  name: string;
  /**
   * What the spell does:
   * - star: a magic star flies to the witch
   * - potion: a potion bottle is thrown at the witch
   * - monkeys: flying monkeys attack the witch (the Golden Cap spell from The Wizard of Oz calls them)
   * - rabbit: a glowing rabbit (a Patronus) hops at the witch
   */
  effect: 'star' | 'potion' | 'monkeys' | 'rabbit';
  /**
   * The movement, from start to end. Coordinates from -1 to 1
   * (x: left -> right, y: top -> bottom); scaled to the spell area on screen.
   */
  shape: Point[];
}

/** Points on a circle (or part of one), for round movements. */
function arc(fromDeg: number, toDeg: number, steps: number, rx = 0.85, ry = 0.85): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((fromDeg + ((toDeg - fromDeg) * i) / steps) * Math.PI) / 180;
    points.push({ x: Math.cos(a) * rx, y: Math.sin(a) * ry });
  }
  return points;
}

/** A wave from left to right. */
function wave(waves: number, height: number, steps: number): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const x = -0.9 + (1.8 * i) / steps;
    points.push({ x, y: -Math.sin(((x + 0.9) / 1.8) * waves * Math.PI * 2) * height });
  }
  return points;
}

export const SPELLS: SpellDef[] = [
  {
    name: 'Expelliarmus',
    effect: 'star',
    // A lightning bolt from top to bottom.
    shape: [
      { x: -0.5, y: -0.9 },
      { x: 0.35, y: -0.2 },
      { x: -0.35, y: 0.15 },
      { x: 0.5, y: 0.9 },
    ],
  },
  {
    name: 'Expecto Patronum',
    effect: 'rabbit',
    // A wave, from left to right.
    shape: wave(1.5, 0.45, 30),
  },
  {
    // The Golden Cap spell from The Wizard of Oz: one spell in three parts.
    name: 'Ep-pe, pep-pe, kak-ke!\nHil-lo, hol-lo, hel-lo!\nZiz-zy, zuz-zy, zik!',
    effect: 'monkeys',
    // A full circle, starting at the top, going right (clockwise).
    shape: arc(-90, 270, 28),
  },
  {
    name: 'Toverdrank!',
    effect: 'potion',
    // Throwing a potion: a big arch from bottom left over the top to bottom right.
    shape: arc(180, 360, 20, 0.85, 0.85).map((p) => ({ x: p.x, y: p.y + 0.4 })),
  },
];

/** Scale a shape to the screen: center (cx, cy), size = width/height of the -1..1 box. */
export function placeShape(shape: Point[], cx: number, cy: number, size: number): Point[] {
  return shape.map((p) => ({ x: cx + (p.x * size) / 2, y: cy + (p.y * size) / 2 }));
}

/** Points along a line at (about) equal distances, for the dots on screen. */
export function resample(line: Point[], spacing: number): Point[] {
  const result: Point[] = [{ ...line[0] }];
  let carry = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    let d = spacing - carry;
    while (d <= length) {
      const t = d / length;
      result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      d += spacing;
    }
    carry = length - (d - spacing);
  }
  const last = line[line.length - 1];
  const end = result[result.length - 1];
  if (Math.hypot(last.x - end.x, last.y - end.y) > spacing / 3) result.push({ ...last });
  return result;
}

/**
 * Follows the wand along the dots. The wand has to come within `radius` of
 * the next dot; it may skip a few dots (`lookAhead`), so a slightly sloppy
 * movement still counts, but it can't take a shortcut to the end.
 */
export class SpellTrace {
  /** How many dots have been reached so far. */
  reached = 0;

  constructor(
    readonly dots: Point[],
    private readonly radius: number,
    private readonly lookAhead = 3,
  ) {}

  get done(): boolean {
    return this.reached >= this.dots.length;
  }

  /**
   * The wand moved from `from` to `to`. Checks the whole movement in small
   * steps, so a fast movement doesn't jump over dots. Returns true when more
   * dots were reached.
   */
  feed(from: Point, to: Point): boolean {
    const before = this.reached;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(length / (this.radius / 2)));
    for (let s = 1; s <= steps && !this.done; s++) {
      const t = s / steps;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      const last = Math.min(this.reached + this.lookAhead, this.dots.length - 1);
      for (let i = last; i >= this.reached; i--) {
        const dot = this.dots[i];
        if (Math.hypot(dot.x - x, dot.y - y) <= this.radius) {
          this.reached = i + 1;
          break;
        }
      }
    }
    return this.reached > before;
  }
}
