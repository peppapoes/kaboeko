/*
 * Small HTML overlay for the controller: connect button, mode label,
 * debug panel (key D) and the pointer images. Kept outside Phaser so it
 * works the same in every scene.
 */

import { GAME_HEIGHT } from '../config';
import type { InputMode } from './InputManager';

/** Elements marked with this attribute are never treated as game clicks. */
export const UI_ATTRIBUTE = 'data-kb-ui';

/** Arrow shown at the tilt cursor (one-pointer mode). Its tip is the click point. */
const ARROW = { src: 'assets/ui/cursor.svg', size: 44, tipX: 3, tipY: 3 };

/** Hands for the two players (split mode, e.g. the genre screen). */
const HANDS = {
  1: { src: 'assets/general/pointer-player1.svg' },
  2: { src: 'assets/general/pointer-player2.svg' },
};
/** Hand image: 391 x 452, fingertip (the click point) at 147, 2. */
const HAND = { width: 391, height: 452, tipX: 147, tipY: 2 };
/** Height of a hand on screen, in game pixels (the game is 1280 high). */
const HAND_HEIGHT = 110;

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
`;

export class ControllerUI {
  private readonly label: HTMLSpanElement;
  private readonly button: HTMLButtonElement;
  private readonly debug: HTMLPreElement;
  private readonly arrow: HTMLImageElement;
  private readonly hands: Record<1 | 2, HTMLImageElement>;
  private flashTimer?: number;
  private mode: InputMode = 'mouse';
  private split = false;

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
    this.hands = { 1: this.makePointer(HANDS[1].src), 2: this.makePointer(HANDS[2].src) };

    document.body.append(panel, this.debug);
    this.setMode('mouse');
  }

  setMode(mode: InputMode) {
    this.mode = mode;
    document.body.classList.toggle('kb-tilt', mode === 'tilt');
    this.showLabel();
  }

  /** Split mode: two hands instead of the system cursor. */
  setSplit(split: boolean) {
    this.split = split;
    document.body.classList.toggle('kb-split', split);
    this.showLabel();
  }

  /** Hide the connect button while at least one controller is connected. */
  setConnected(count: number) {
    this.button.style.display = count > 0 ? 'none' : '';
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
  setArrow(clientX: number, clientY: number, visible: boolean) {
    this.place(this.arrow, clientX - ARROW.tipX, clientY - ARROW.tipY, visible);
  }

  /** A player's hand, with the fingertip at (clientX, clientY). */
  setHand(player: 1 | 2, clientX: number, clientY: number, canvasHeight: number, visible: boolean) {
    const hand = this.hands[player];
    const height = (HAND_HEIGHT / GAME_HEIGHT) * canvasHeight;
    const width = (height * HAND.width) / HAND.height;
    hand.style.height = `${height}px`;
    hand.style.width = `${width}px`;
    this.place(hand, clientX - (HAND.tipX / HAND.width) * width, clientY - (HAND.tipY / HAND.height) * height, visible);
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

  private showLabel(extra?: string) {
    let text = this.mode === 'tilt' ? '🎮 controller' : '🖱 mouse';
    if (this.split) text = this.mode === 'tilt' ? '🎮 P1 controller · 🖱 P2 mouse' : '🖱 P2 mouse (no controller)';
    this.label.textContent = extra ? `${text} · ${extra}` : text;
  }
}
