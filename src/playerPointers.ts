import type { GameObjects, Input, Scene } from 'phaser';
import { RENDER_SCALE } from './config';
import { inputManager } from './input/InputManager';

/*
 * The players' hands, shown instead of the normal mouse cursor. Each player
 * has their own colour, so you see who is who.
 *
 * - Without controller: one hand, following the mouse. The mouse is player 2.
 * - With controller, one pointer (most screens): the one hand follows the
 *   controller and gets player 1's colour (the controller is player 1).
 * - With controller, split mode (genre screen, see inputManager.setSplit):
 *   two hands. Player 1 follows the controller, player 2 the mouse.
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
/** The player who uses the mouse (when a controller is in use, the controller is player 1). */
export const MOUSE_PLAYER: PlayerNumber = 2;
const CONTROLLER_PLAYER: PlayerNumber = 1;
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
  /** Has the (mouse) pointer been over the game since show()? (Before that we don't know where it is.) */
  private pointerSeen = false;
  /** Where Phaser's pointer is, in game coordinates (the mouse, or the controller in one-pointer mode). */
  private pointer = { x: 0, y: 0 };

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
    scene.events.on('update', this.refresh, this);
    scene.events.once('shutdown', () => {
      scene.input.off('pointermove', this.onPointerMove, this);
      scene.events.off('update', this.refresh, this);
      scene.input.setDefaultCursor('default');
    });
  }

  /** Show the hands instead of the system cursor. */
  show() {
    this.visible = true;
    this.scene.input.setDefaultCursor('none');
    // Start where the pointer already is, if we know it.
    const pointer = this.scene.input.activePointer;
    this.pointerSeen = pointer.x !== 0 || pointer.y !== 0;
    if (this.pointerSeen) this.movePointer(pointer);
    this.refresh();
  }

  /** Back to the normal system cursor. */
  hide() {
    this.visible = false;
    this.scene.input.setDefaultCursor('default');
    this.refresh();
  }

  private onPointerMove(pointer: Input.Pointer) {
    this.pointerSeen = true;
    this.movePointer(pointer);
    this.refresh();
  }

  private movePointer(pointer: Input.Pointer) {
    const { x, y } = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    this.pointer = { x, y };
  }

  /** Every frame: place and show the right hands. */
  private refresh() {
    const controller = inputManager.getMode() === 'tilt';
    const split = inputManager.isSplit(this.scene);

    let show: Partial<Record<PlayerNumber, { x: number; y: number }>>;
    if (controller && split) {
      // Two players: 1 on the controller, 2 on the mouse.
      show = { [CONTROLLER_PLAYER]: inputManager.getPlayerCursor(CONTROLLER_PLAYER) };
      if (this.pointerSeen) show[MOUSE_PLAYER] = this.pointer;
    } else if (controller) {
      // One pointer, moved by the controller: player 1's hand, at the controller's cursor.
      show = { [CONTROLLER_PLAYER]: inputManager.getPlayerCursor(CONTROLLER_PLAYER) };
    } else {
      // Only the mouse: player 2's hand.
      show = this.pointerSeen ? { [MOUSE_PLAYER]: this.pointer } : {};
    }

    for (const player of [1, 2] as const) {
      const hand = this.hands[player];
      const at = show[player];
      hand.setVisible(this.visible && !!at);
      if (at) hand.setPosition(at.x, at.y);
    }
  }
}
