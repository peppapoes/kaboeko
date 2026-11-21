import type { GameObjects, Input, Scene } from 'phaser';
import { RENDER_SCALE } from './config';

/*
 * The players' hands, shown instead of the normal mouse cursor (e.g. on the
 * genre screen). Each player has their own colour, so you see who is who.
 *
 * For now only the mouse exists, and the mouse is player 2. Player 1's hand
 * can be moved with setPosition(1, x, y), e.g. by a controller later.
 *
 * Usage in a scene:
 *   preload():  PlayerPointers.preload(this);
 *   create():   this.pointers = new PlayerPointers(this);
 *               this.pointers.show();   // hands on, system cursor off
 *               this.pointers.hide();   // back to the normal cursor
 */

export type PlayerNumber = 1 | 2;

const HAND_FILES: Record<PlayerNumber, string> = {
  1: 'assets/general/pointer-player1.svg',
  2: 'assets/general/pointer-player2.svg',
};
const textureKey = (player: PlayerNumber) => `pointer-player${player}`;

/** The hand image is 391 x 452 with the fingertip (the click point) at 147, 2. */
const HAND = { width: 391, height: 452, tipX: 147, tipY: 2 };
/** Height of a hand on screen, in game pixels. */
const HAND_HEIGHT = 110;
/** The player who uses the mouse. */
export const MOUSE_PLAYER: PlayerNumber = 2;
/** Draw the hands on top of everything. */
const DEPTH = 1000;

export class PlayerPointers {
  static preload(scene: Scene) {
    const height = HAND_HEIGHT * RENDER_SCALE;
    const width = Math.round((height * HAND.width) / HAND.height);
    for (const player of [1, 2] as const) {
      scene.load.svg(textureKey(player), HAND_FILES[player], { width, height });
    }
  }

  private readonly hands: Record<PlayerNumber, GameObjects.Image>;
  private visible = false;
  /** Has the mouse been over the game since show()? (Before that we don't know where it is.) */
  private mouseSeen = false;

  constructor(private readonly scene: Scene) {
    const make = (player: PlayerNumber) =>
      scene.add
        .image(0, 0, textureKey(player))
        .setOrigin(HAND.tipX / HAND.width, HAND.tipY / HAND.height)
        .setScale(1 / RENDER_SCALE)
        .setDepth(DEPTH)
        .setVisible(false);
    this.hands = { 1: make(1), 2: make(2) };

    scene.input.on('pointermove', this.onPointerMove, this);
    scene.events.once('shutdown', () => {
      scene.input.off('pointermove', this.onPointerMove, this);
      scene.input.setDefaultCursor('default');
    });
  }

  /** Show the hands instead of the system cursor. */
  show() {
    this.visible = true;
    this.scene.input.setDefaultCursor('none');
    // Start where the mouse already is, if we know it.
    const pointer = this.scene.input.activePointer;
    this.mouseSeen = pointer.x !== 0 || pointer.y !== 0;
    if (this.mouseSeen) this.moveMouseHand(pointer);
    this.refresh();
  }

  /** Back to the normal system cursor. */
  hide() {
    this.visible = false;
    this.scene.input.setDefaultCursor('default');
    this.refresh();
  }

  /** Move a player's hand (game coordinates). Player 1 has no input yet; a controller can use this. */
  setPosition(player: PlayerNumber, x: number, y: number) {
    this.hands[player].setPosition(x, y).setData('placed', true);
    this.refresh();
  }

  private onPointerMove(pointer: Input.Pointer) {
    this.mouseSeen = true;
    this.moveMouseHand(pointer);
    this.refresh();
  }

  private moveMouseHand(pointer: Input.Pointer) {
    const { x, y } = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    this.hands[MOUSE_PLAYER].setPosition(x, y);
  }

  private refresh() {
    for (const player of [1, 2] as const) {
      const hand = this.hands[player];
      const known = player === MOUSE_PLAYER ? this.mouseSeen : hand.getData('placed') === true;
      hand.setVisible(this.visible && known);
    }
  }
}
