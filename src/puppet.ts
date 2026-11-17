import { GameObjects, Math as PMath, Scene, Tweens } from 'phaser';

/*
 * "Puppet theatre" animations: things enter from outside the screen like
 * paper puppets (on a stick from below, on a string from above, or from the
 * side), overshoot a little, wobble, and keep swaying gently while they stay.
 *
 * Tip: give a puppet its origin at the point where it is "held" (bottom of
 * the stick, top of the string), so it rotates around that point.
 */

/** Anything with a position, angle and scale. */
export type Puppet = GameObjects.Image | GameObjects.Container;

export interface MoveOptions {
  delay?: number;
  duration?: number;
  /** How far outside its final position the puppet starts/ends. */
  distance?: number;
  /** Keep swaying after arriving (default true). */
  sway?: boolean;
  onComplete?: () => void;
}

const randomSide = () => (Math.random() < 0.5 ? -1 : 1);

/**
 * Overshoot when arriving. Kept small so the end of a stick or post never
 * pops into view (keep at least ~10% of the travel distance hidden below/above the screen).
 */
const ARRIVE = { ease: 'Back.Out', easeParams: [1.2] };

/** Gentle never-ending sway, like a puppet held by a hand. */
export function sway(scene: Scene, target: Puppet, amount = 1.2, duration = PMath.Between(2200, 3000)) {
  stopSway(target);
  const phase = Math.random() * Math.PI * 2;
  const base = target.angle;
  const tween = scene.tweens.addCounter({
    from: 0,
    to: Math.PI * 2,
    duration,
    repeat: -1,
    onUpdate: (t) => {
      target.angle = base + amount * Math.sin((t.getValue() ?? 0) + phase) - amount * Math.sin(phase);
    },
  });
  target.setData('sway', tween);
  target.once('destroy', () => tween.remove());
}

export function stopSway(target: Puppet) {
  (target.getData('sway') as Tweens.Tween | undefined)?.remove();
  target.setData('sway', undefined);
}

/** Wobble that dies out, then (optionally) keep swaying. */
function wobbleIn(scene: Scene, target: Puppet, delay: number, duration: number, opts: MoveOptions) {
  scene.tweens.add({
    targets: target,
    angle: { from: randomSide() * 7, to: 0 },
    delay,
    duration: duration * 1.8,
    ease: 'Elastic.Out',
    easeParams: [1, 0.35],
    onComplete: () => {
      if (opts.sway !== false) sway(scene, target);
      opts.onComplete?.();
    },
  });
}

/** Comes up from below, like a puppet on a stick. */
export function riseIn(scene: Scene, target: Puppet, opts: MoveOptions = {}) {
  const { delay = 0, duration = 900, distance = 700 } = opts;
  const y = target.y;
  target.y = y + distance;
  scene.tweens.add({ targets: target, y, delay, duration, ...ARRIVE });
  wobbleIn(scene, target, delay, duration, opts);
}

/** Comes down from above, like a puppet on a string. */
export function dropIn(scene: Scene, target: Puppet, opts: MoveOptions = {}) {
  const { delay = 0, duration = 900, distance = 500 } = opts;
  const y = target.y;
  target.y = y - distance;
  scene.tweens.add({ targets: target, y, delay, duration, ...ARRIVE });
  wobbleIn(scene, target, delay, duration, opts);
}

/** Slides in from the left or right side of the screen. */
export function slideIn(scene: Scene, target: Puppet, from: 'left' | 'right', opts: MoveOptions = {}) {
  const { delay = 0, duration = 800, distance = 1200 } = opts;
  const x = target.x;
  target.x = x + (from === 'left' ? -distance : distance);
  scene.tweens.add({ targets: target, x, delay, duration, ease: 'Back.Out' });
  wobbleIn(scene, target, delay, duration, opts);
}

/** Pops up from nothing (for buttons and small things). */
export function popIn(scene: Scene, target: Puppet, opts: MoveOptions = {}) {
  const { delay = 0, duration = 500 } = opts;
  const scale = target.scale;
  target.setScale(0);
  scene.tweens.add({ targets: target, scale, delay, duration, ease: 'Back.Out', onComplete: opts.onComplete });
}

/** Leaves downwards, out of the screen. */
export function sinkOut(scene: Scene, target: Puppet, opts: MoveOptions = {}) {
  const { delay = 0, duration = 500, distance = 900 } = opts;
  stopSway(target);
  scene.tweens.killTweensOf(target);
  scene.tweens.add({
    targets: target,
    y: target.y + distance,
    angle: randomSide() * 8,
    delay,
    duration,
    ease: 'Back.In',
    onComplete: opts.onComplete,
  });
}

/** Leaves to the left or right side of the screen. */
export function slideOut(scene: Scene, target: Puppet, to: 'left' | 'right', opts: MoveOptions = {}) {
  const { delay = 0, duration = 500, distance = 1200 } = opts;
  stopSway(target);
  scene.tweens.killTweensOf(target);
  scene.tweens.add({
    targets: target,
    x: target.x + (to === 'left' ? -distance : distance),
    delay,
    duration,
    ease: 'Back.In',
    onComplete: opts.onComplete,
  });
}

/** A push that makes the puppet swing and settle again (e.g. when something lands on it). */
export function swing(scene: Scene, target: Puppet, strength = 6) {
  stopSway(target);
  scene.tweens.add({
    targets: target,
    angle: { from: randomSide() * strength, to: 0 },
    duration: 1600,
    ease: 'Elastic.Out',
    easeParams: [1, 0.35],
    onComplete: () => sway(scene, target),
  });
}

/** Small jump with a wiggle (e.g. when something pops out of the sand). */
export function hop(scene: Scene, target: Puppet, onComplete?: () => void) {
  scene.tweens.add({ targets: target, y: target.y - 40, duration: 180, ease: 'Quad.Out', yoyo: true });
  scene.tweens.add({
    targets: target,
    angle: { from: target.angle - 10, to: target.angle },
    duration: 900,
    ease: 'Elastic.Out',
    easeParams: [1, 0.3],
    onComplete,
  });
}
