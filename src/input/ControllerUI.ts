/*
 * Small HTML overlay for the controller: connect button, mode label,
 * debug panel (Shift+D) and an arrow cursor. Kept outside Phaser so it works
 * the same in every scene.
 *
 * The players' hands are drawn by the scenes themselves (src/playerPointers.ts);
 * the arrow is only for screens without hands or tools.
 */

import type { InputMode } from './InputManager';

/** Elements marked with this attribute are never treated as game clicks. */
export const UI_ATTRIBUTE = 'data-kb-ui';

/** Arrow shown at the tilt cursor (one-pointer mode). Its tip is the click point. */
const ARROW = { src: 'assets/ui/cursor.svg', size: 44, tipX: 3, tipY: 3 };

const STYLE = `
  body.kb-tilt canvas, body.kb-split canvas { cursor: none !important; }
  .kb-panel {
    position: fixed; top: 10px; right: 10px; z-index: 10;
    display: flex; gap: 6px; align-items: center;
    font: 12px/1.2 system-ui, sans-serif; color: #fff;
  }
  .kb-panel button, .kb-label {
    padding: 5px 9px; border-radius: 6px; border: 0;
    background: rgba(0, 0, 0, 0.55); color: #fff; font: inherit; cursor: pointer;
  }
  .kb-panel button:disabled { opacity: 0.5; cursor: default; }
  .kb-label { cursor: default; }
  .kb-debug {
    position: fixed; top: 44px; right: 10px; z-index: 10; margin: 0;
    padding: 8px 10px; border-radius: 6px; background: rgba(0, 0, 0, 0.75);
    color: #9f9; font: 12px/1.4 ui-monospace, monospace; white-space: pre; display: none;
  }
  .kb-pointer {
    position: fixed; left: 0; top: 0; z-index: 20; pointer-events: none; display: none;
  }
  .kb-target {
    /* The target itself is centered on the given point (that is where the kids should point). */
    position: fixed; left: 0; top: 0; z-index: 15; pointer-events: none; display: none;
    transform: translate(-50%, -50%);
    font: 600 28px/1.2 Oswald, sans-serif; color: #fff; text-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
  }
  .kb-target span {
    position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%);
    margin-bottom: 0.4em; white-space: nowrap;
  }
  .kb-target svg { display: block; overflow: visible; filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3)); }
  /* The ring fills up (clockwise from the top) while everyone holds still. */
  .kb-target .fill { transform: rotate(-90deg); transform-origin: 50% 50%; stroke-linecap: round; transition: stroke-dashoffset 0.08s linear; }
`;

/**
 * "Point at the circle": a thin, see-through ring with a dot in the middle. A white arc fills
 * it while all players who have to calibrate hold their controller still (together).
 */
const RING_RADIUS = 42;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
const TARGET_SVG = `
  <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <circle cx="50" cy="50" r="${RING_RADIUS}" fill="none" stroke="#FFFFFF" stroke-opacity="0.35" stroke-width="5"/>
    <circle class="fill" cx="50" cy="50" r="${RING_RADIUS}" fill="none" stroke="#FFFFFF" stroke-width="5"
      stroke-dasharray="${RING_LENGTH}" stroke-dashoffset="${RING_LENGTH}"/>
    <circle cx="50" cy="50" r="4" fill="#FFFFFF"/>
  </svg>`;

export class ControllerUI {
  private readonly label: HTMLSpanElement;
  private readonly button: HTMLButtonElement;
  private readonly debug: HTMLPreElement;
  private readonly arrow: HTMLImageElement;
  private readonly target: HTMLDivElement;
  private readonly targetText: HTMLSpanElement;
  private flashTimer?: number;
  private mode: InputMode = 'mouse';
  private split = false;
  /** Which controller player 1 uses, shown in the label. */
  private controllerName = 'controller';
  /** Which controller player 2 uses, while it is in use (else player 2 is the mouse). */
  private player2Name?: string;

  constructor(onConnect: () => void, serialSupported: boolean) {
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.className = 'kb-panel';
    panel.setAttribute(UI_ATTRIBUTE, '');

    this.button = document.createElement('button');
    this.button.textContent = 'Connect controller';
    if (serialSupported) {
      this.button.addEventListener('click', onConnect);
    } else {
      this.button.disabled = true;
      this.button.title = 'Web Serial only works in Chrome or Edge';
    }

    this.label = document.createElement('span');
    this.label.className = 'kb-label';
    panel.append(this.button, this.label);

    this.debug = document.createElement('pre');
    this.debug.className = 'kb-debug';
    this.debug.setAttribute(UI_ATTRIBUTE, '');

    this.arrow = this.makePointer(ARROW.src);
    this.arrow.style.width = this.arrow.style.height = `${ARROW.size}px`;

    this.target = document.createElement('div');
    this.target.className = 'kb-target';
    this.targetText = document.createElement('span');
    this.target.innerHTML = TARGET_SVG;
    this.target.prepend(this.targetText);

    document.body.append(panel, this.debug, this.target);
    this.setMode('mouse');
  }

  setMode(mode: InputMode) {
    this.mode = mode;
    document.body.classList.toggle('kb-tilt', mode === 'tilt');
    this.showLabel();
  }

  /** Split mode: player 1 on the controller, player 2 on the mouse (shown in the label). */
  setSplit(split: boolean) {
    this.split = split;
    document.body.classList.toggle('kb-split', split);
    this.showLabel();
  }

  /** The connect button stays until both controllers are connected. */
  setConnected(count: number) {
    this.button.style.display = count >= 2 ? 'none' : '';
    this.button.textContent = count === 1 ? 'Connect controller 2' : 'Connect controller';
  }

  /** Show a short message next to the mode for a moment. */
  flash(message: string) {
    this.showLabel(message);
    window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => this.showLabel(), 1500);
  }

  toggleDebug() {
    this.debug.style.display = this.debug.style.display === 'block' ? 'none' : 'block';
  }

  get debugVisible() {
    return this.debug.style.display === 'block';
  }

  setDebugText(text: string) {
    this.debug.textContent = text;
  }

  /**
   * "Point at the circle", in the middle of the game, with the text above it.
   * progress: how far the ring is filled (0..1), i.e. how long everyone has held still together.
   */
  setTarget(clientX: number, clientY: number, canvasHeight: number, text: string, visible: boolean, progress = 0) {
    this.target.style.display = visible ? 'block' : 'none';
    if (!visible) return;
    const size = canvasHeight * 0.12;
    const svg = this.target.querySelector('svg');
    if (svg) svg.setAttribute('width', `${size}`), svg.setAttribute('height', `${size}`);
    const fill = this.target.querySelector<SVGCircleElement>('.fill');
    fill?.setAttribute('stroke-dashoffset', `${RING_LENGTH * (1 - Math.min(Math.max(progress, 0), 1))}`);
    this.targetText.textContent = text;
    this.target.style.fontSize = `${Math.max(14, canvasHeight * 0.035)}px`;
    this.target.style.left = `${clientX}px`;
    this.target.style.top = `${clientY}px`;
  }

  /** The arrow, with its tip at (clientX, clientY). */
  setArrow(clientX: number, clientY: number, visible: boolean) {
    this.place(this.arrow, clientX - ARROW.tipX, clientY - ARROW.tipY, visible);
  }

  private makePointer(src: string): HTMLImageElement {
    const image = document.createElement('img');
    image.className = 'kb-pointer';
    image.src = src;
    image.alt = '';
    document.body.append(image);
    return image;
  }

  private place(element: HTMLElement, left: number, top: number, visible: boolean) {
    element.style.display = visible ? 'block' : 'none';
    if (visible) element.style.transform = `translate(${left}px, ${top}px)`;
  }

  /** Show which controller a player uses ('mpu', 'nunchuk' or the keyboard); undefined = player 2 has none (any more). */
  setControllerType(type: 'mpu' | 'nunchuk' | 'keyboard' | undefined, player: number = 1) {
    const names = { mpu: 'MPU-6050', nunchuk: 'Nunchuk', keyboard: 'keyboard' };
    const name = type && names[type];
    if (player === 2) this.player2Name = name;
    else if (name) this.controllerName = name;
    this.showLabel();
  }

  private showLabel(extra?: string) {
    const name = this.controllerName;
    const p2 = this.player2Name ? `🎮 P2 ${this.player2Name}` : '🖱 P2 mouse';
    const icon = name === 'keyboard' ? '⌨️' : '🎮';
    let text = this.mode === 'tilt' ? `${icon} ${name}` : '🖱 mouse';
    if (this.split || this.player2Name) {
      text = this.mode === 'tilt' ? `${icon} P1 ${name} · ${p2}` : this.player2Name ? `P1 no controller · ${p2}` : '🖱 P2 mouse (no controller)';
    }
    this.label.textContent = extra ? `${text} · ${extra}` : text;
  }
}
