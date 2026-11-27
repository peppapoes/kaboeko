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
   * Where the spell comes from: shown on a quote card after casting it, like
   * the quotes in geschiedenis (e.g. "Harry Potter").
   */
  source: string;
  /**
   * What the spell does:
   * - star: a magic star flies to the witch
   * - potion: a potion bottle is thrown at the witch
   * - deer: a deer (a Patronus) goes at the witch
   * - sword: a pen is thrown and turns into a sword halfway (Percy Jackson's Riptide)
   */
  effect: 'star' | 'potion' | 'deer' | 'sword';
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
    source: 'Harry Potter',
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
    source: 'Harry Potter',
    effect: 'deer',
    // A wave, from left to right.
    shape: wave(1.5, 0.45, 30),
  },
  {
    // Percy Jackson's pen that turns into a sword: Anaklusmos ("Riptide"), in the Dutch books "Doemtij".
    name: 'Anaklusmos\nDoemtij',
    source: 'Percy Jackson',
    effect: 'sword',
    // Up and down again (throwing the pen): up on the left, down on the right, so the dots don't overlap.
    shape: [
      { x: -0.25, y: 0.85 },
      { x: 0, y: -0.85 },
      { x: 0.25, y: 0.85 },
    ],
  },
  {
    name: 'Toverdrank!',
    source: 'Asterix en Obelix',
    effect: 'potion',
    // Throwing a potion: a big arch from bottom left over the top to bottom right.
    shape: arc(180, 360, 20, 0.85, 0.85).map((p) => ({ x: p.x, y: p.y + 0.4 })),
  },
];

/** The short practice movement in the intro (a small wave, left to right). */
export const PRACTICE_SHAPE: Point[] = wave(1, 0.35, 16);

/** Scale a shape to the screen: center (cx, cy), size = width/height of the -1..1 box. */
export function placeShape(shape: Point[], cx: number, cy: number, size: number): Point[] {
  return shape.map((p) => ({ x: cx + (p.x * size) / 2, y: cy + (p.y * size) / 2 }));
}

/**
 * The dots on screen along a line, about `spacing` apart. There is always a
 * dot exactly on every corner and on the end, and the dots between two
 * corners are spread evenly (so no dots squeezed together near a corner).
 */
export function resample(line: Point[], spacing: number): Point[] {
  // Split the line into smooth pieces at its corners (where it turns sharply).
  const pieces: Point[][] = [[line[0]]];
  for (let i = 1; i < line.length; i++) {
    pieces[pieces.length - 1].push(line[i]);
    if (i < line.length - 1 && turn(line[i - 1], line[i], line[i + 1]) > CORNER) pieces.push([line[i]]);
  }

  const result: Point[] = [{ ...line[0] }];
  for (const piece of pieces) {
    const length = lengthOf(piece);
    const steps = Math.max(1, Math.round(length / spacing));
    for (let k = 1; k <= steps; k++) result.push(pointAt(piece, (length * k) / steps));
  }
  return result;
}

/** A turn sharper than this (radians) is a corner. */
const CORNER = (35 * Math.PI) / 180;

/** How much the line turns at `b` (radians, 0 = straight on). */
function turn(a: Point, b: Point, c: Point): number {
  const d = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x);
  return Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
}

/** The point at `distance` along a line. */
function pointAt(line: Point[], distance: number): Point {
  let left = distance;
  for (let i = 1; i < line.length; i++) {
    const step = Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y);
    if (left <= step || i === line.length - 1) {
      const t = step === 0 ? 0 : Math.min(left / step, 1);
      return { x: line[i - 1].x + (line[i].x - line[i - 1].x) * t, y: line[i - 1].y + (line[i].y - line[i - 1].y) * t };
    }
    left -= step;
  }
  return { ...line[line.length - 1] };
}

function lengthOf(line: Point[]): number {
  let length = 0;
  for (let i = 1; i < line.length; i++) length += Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y);
  return length;
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
