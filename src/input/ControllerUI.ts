/*
 * Small HTML overlay for the controller: connect button, mode label,
 * debug panel (key D) and an arrow cursor. Kept outside Phaser so it works
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
  .kb-star {
    /* The star itself is centered on the given point (that is where the kids should point). */
    position: fixed; left: 0; top: 0; z-index: 15; pointer-events: none; display: none;
    transform: translate(-50%, -50%);
    font: 600 28px/1.2 Oswald, sans-serif; color: #fff; text-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
  }
  .kb-star span {
    position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%);
    margin-bottom: 0.4em; white-space: nowrap;
  }
  .kb-star svg { display: block; animation: kb-star-pulse 1s ease-in-out infinite alternate; }
  @keyframes kb-star-pulse { from { transform: scale(0.9) rotate(-6deg); } to { transform: scale(1.08) rotate(6deg); } }
`;

/** A simple five-pointed star (for "point at the star"). */
const STAR_SVG = `
  <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
    <path d="M50 5 L61.8 37.6 L96.6 38.2 L69 59.4 L79 92.6 L50 72.8 L21 92.6 L31 59.4 L3.4 38.2 L38.2 37.6 Z"
      fill="#FFD23F" stroke="#FFFFFF" stroke-width="6" stroke-linejoin="round"/>
  </svg>`;

export class ControllerUI {
  private readonly label: HTMLSpanElement;
  private readonly button: HTMLButtonElement;
  private readonly debug: HTMLPreElement;
  private readonly arrow: HTMLImageElement;
  private readonly star: HTMLDivElement;
  private readonly starText: HTMLSpanElement;
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

    this.star = document.createElement('div');
    this.star.className = 'kb-star';
    this.starText = document.createElement('span');
    this.star.innerHTML = STAR_SVG;
    this.star.prepend(this.starText);

    document.body.append(panel, this.debug, this.star);
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

  /** The arrow, with its tip at (clientX, clientY). */
  /** "Point at the star": the star in the middle of the game, with the text above it. */
  setStar(clientX: number, clientY: number, canvasHeight: number, text: string, visible: boolean) {
    this.star.style.display = visible ? 'block' : 'none';
    if (!visible) return;
    const size = canvasHeight * 0.16;
    const svg = this.star.querySelector('svg');
    if (svg) svg.setAttribute('width', `${size}`), svg.setAttribute('height', `${size}`);
    this.starText.textContent = text;
    this.star.style.fontSize = `${Math.max(16, canvasHeight * 0.045)}px`;
    this.star.style.left = `${clientX}px`;
    this.star.style.top = `${clientY}px`;
  }

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

  /** Show which controller a player uses ('mpu' or 'nunchuk'); undefined = player 2 has none (any more). */
  setControllerType(type: 'mpu' | 'nunchuk' | undefined, player: number = 1) {
    const name = type === 'nunchuk' ? 'Nunchuk' : type === 'mpu' ? 'MPU-6050' : undefined;
    if (player === 2) this.player2Name = name;
    else if (name) this.controllerName = name;
    this.showLabel();
  }

  private showLabel(extra?: string) {
    const name = this.controllerName;
    const p2 = this.player2Name ? `🎮 P2 ${this.player2Name}` : '🖱 P2 mouse';
    let text = this.mode === 'tilt' ? `🎮 ${name}` : '🖱 mouse';
    if (this.split || this.player2Name) {
      text = this.mode === 'tilt' ? `🎮 P1 ${name} · ${p2}` : this.player2Name ? `P1 no controller · ${p2}` : '🖱 P2 mouse (no controller)';
    }
    this.label.textContent = extra ? `${text} · ${extra}` : text;
  }
}
