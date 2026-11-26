import { Events, Input, type Game, type GameObjects, type Scene } from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config';
import { CONTROLLER_CONFIG as CFG } from './controllerConfig';
import { ControllerUI, UI_ATTRIBUTE } from './ControllerUI';
import { SerialController, type ControllerMessage } from './SerialController';

/*
 * Central input for the whole game: mouse/trackpad and a tilt controller
 * (ESP32 + MPU-6050 over Web Serial, player 1).
 *
 * Two ways of working:
 *
 * 1. One pointer (default, e.g. title screens and the minigame).
 *    When the controller sends data ("tilt" mode), the tilt cursor drives
 *    Phaser's normal mouse pointer: moving it sends a mouse move to the canvas
 *    at that spot, and a real trackpad click is replayed at the tilt cursor.
 *    Scenes just use their normal Phaser input and work in both modes.
 *
 * 2. Split (two players, e.g. the genre screen): call setSplit(scene).
 *    Player 2 uses the mouse normally (click = player 2). Player 1 has an own
 *    pointer that follows the controller; player 1 "clicks" with Space (or the
 *    controller button), which presses the object under player 1's pointer.
 *    Both players get their own pointer image. Call setSplit(null) to stop.
 *
 * Player 2 can also use a controller (connect a second one). Player 2 is "the
 * mouse" everywhere, so player 2's controller simply takes over the mouse
 * pointer: it moves the pointer and its button clicks, as if the mouse did it.
 * Scenes don't need to know. The real mouse is ignored meanwhile (a real click
 * still counts, at player 2's controller cursor).
 * Which controller is which player: the "p" in its messages (PLAYER in the
 * sketch). If both controllers say the same player, the second one to connect
 * becomes the other player, so both sketches can keep PLAYER = 1.
 *
 * Use from anywhere:  import { inputManager } from './input/InputManager';
 *   inputManager.getCursor()        -> { x, y } of the main pointer, in game coordinates
 *   inputManager.getMode()          -> 'mouse' | 'tilt'
 *   inputManager.on('select', ({ x, y, player }) => ...)   a click
 *   inputManager.on('shake', ({ player }) => ...)          controller shaken (start of a shake)
 *   inputManager.on('button', ({ player }) => ...)         controller button pressed (MPU btn, Nunchuk Z)
 *   inputManager.on('back', ({ player }) => ...)           Nunchuk C button pressed
 *   inputManager.on('cursormove', ({ player, x, y }) => ...)  player 1's tilt cursor moved
 *   inputManager.on('modechange', (mode) => ...)
 *
 * Keys: T = switch mouse/controller, C = calibrate, D = debug panel, Space = player 1's button.
 */

export type InputMode = 'mouse' | 'tilt';

export interface Point {
  x: number;
  y: number;
}

/** Latest data from one controller. */
/** Which controller a player uses: detected from the messages ("jx" = Nunchuk). */
export type ControllerType = 'mpu' | 'nunchuk';

export interface PlayerState {
  player: number;
  type: ControllerType;
  /** Nunchuk joystick, -100..100 (right / up positive); 0 for the MPU controller. */
  jx: number;
  jy: number;
  /** Nunchuk C and Z buttons. */
  bc: boolean;
  bz: boolean;
  /** Tilt forward/back and left/right, in degrees (raw, before calibration). */
  x: number;
  y: number;
  /** Rotation (yaw) in degrees from the gyro; drifts slowly, so it is recentered regularly. */
  z: number;
  shake: boolean;
  btn: boolean;
  /** The center (set by calibration): tilt that counts as "level" / pointing straight ahead. */
  neutralX: number;
  neutralY: number;
  neutralZ: number;
  /** performance.now() of the last message. */
  lastSeen: number;
}

/** The controller player whose tilt moves the tilt cursor. */
const TILT_PLAYER = 1;
/** In split mode, the mouse belongs to this player (or player 2's controller, see above). */
const MOUSE_PLAYER = 2;

/** The players that can have a controller. */
type ControllerPlayer = 1 | 2;
const CONTROLLER_PLAYERS: readonly ControllerPlayer[] = [1, 2];

/** Cursor movement of one controller. */
interface Motion {
  cursor: Point;
  /** Rate and joystick control: current speed. */
  velocity: Point;
  /** Point mode: pitch/yaw (degrees from the center) after the jitter filter. */
  held: { pitch: number; yaw: number };
  /** Nunchuk tilt: smoothing per direction. */
  tiltFilter: { x: OneEuroFilter; y: OneEuroFilter };
}

function newMotion(cursor: Point = { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 }): Motion {
  return {
    cursor,
    velocity: { x: 0, y: 0 },
    held: { pitch: 0, yaw: 0 },
    tiltFilter: { x: new OneEuroFilter(), y: new OneEuroFilter() },
  };
}

/** One sample while waiting for the controller to be held still (star recentering). */
interface StillSample {
  time: number;
  pitch: number;
  yaw: number;
}

const DEBUG_REFRESH_MS = 250;
/** Point mode: how fast (seconds) the jitter filter settles on the real angle when held still. */
const JITTER_SETTLE_TIME = 0.4;
/** A frame that took longer than this means the page was busy (e.g. loading): don't time out then. */
const STALL_MS = 200;

class InputManager extends Events.EventEmitter {
  private canvas?: HTMLCanvasElement;
  private ui?: ControllerUI;

  private mode: InputMode = 'mouse';
  /** Set when the player switched to mouse with T while a controller is sending. */
  private preferMouse = false;
  /** Scene in split mode (two pointers), if any. */
  private splitScene?: Scene;
  /** What player 1's pointer is over in split mode (for hover). */
  private splitHover?: GameObjects.GameObject;
  /**
   * One-pointer screens: who controls the pointer right now (e.g. whose turn it is).
   * MOUSE_PLAYER = the mouse, even when a controller is connected; undefined = the default.
   */
  private pointerOwner?: number;

  /** Where the mouse pointer is (player 2): the real mouse, or player 2's controller cursor. */
  private mouse: Point = { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 };
  /** Cursor movement per controller: 1 = the tilt cursor, 2 = player 2's controller. */
  private readonly motion: Record<ControllerPlayer, Motion> = { 1: newMotion(), 2: newMotion() };
  /** Was player 2's controller in use last frame? (To notice when it starts or stops.) */
  private player2WasActive = false;

  /** Player 1's tilt cursor. */
  private get cursor(): Point {
    return this.motion[1].cursor;
  }
  private set cursor(point: Point) {
    this.motion[1].cursor = point;
  }

  /** Point mode: smallest and largest pitch/yaw seen since the last reset (key R), for tuning. */
  private range = emptyRange();
  /** Star recentering: running while set; per player the samples of the last STILL_TIME ms, and who is done. */
  private recentering = false;
  private readonly stillSamples = new Map<number, StillSample[]>();
  private readonly centered = new Set<number>();

  private readonly players = new Map<number, PlayerState>();
  private readonly controllers = new Set<SerialController>();

  /** Mouse events we create ourselves (these go through to Phaser untouched). */
  private readonly synthetic = new WeakSet<Event>();

  private lastFrame = performance.now();
  private messageCount = 0;
  private messagesPerSecond = 0;
  private rateStart = performance.now();
  private lastDebug = 0;

  /** Call once, right after creating the Phaser game. */
  attach(game: Game) {
    const start = () => {
      this.canvas = game.canvas;
      this.ui = new ControllerUI(() => void this.requestController(), !!navigator.serial);

      // Capture phase on window: we see every mouse event before Phaser does.
      for (const type of ['mousemove', 'mousedown', 'mouseup'] as const) {
        window.addEventListener(type, this.onRealMouse, true);
      }
      window.addEventListener('keydown', this.onKey);
      game.events.on('prestep', () => this.update());

      if (navigator.serial) {
        navigator.serial.addEventListener('connect', (event) => void this.openPort(event.target as SerialPort));
        navigator.serial.addEventListener('disconnect', (event) => this.closePort(event.target as SerialPort));
        void this.reconnectKnownPorts();
      }
    };

    if (game.isBooted) start();
    else game.events.once('ready', start);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  getMode(): InputMode {
    return this.mode;
  }

  /** Position of the main pointer in game coordinates (the tilt cursor in tilt mode, else the mouse). */
  getCursor(): Point {
    return this.mode === 'tilt' && !this.splitScene ? { ...this.cursor } : { ...this.mouse };
  }

  /** Position of one player's pointer (split mode: 1 = controller, 2 = mouse or player 2's controller). */
  getPlayerCursor(player: number): Point {
    return player === TILT_PLAYER ? { ...this.cursor } : { ...this.mouse };
  }

  /** Latest data of one controller (player 1 or 2), if it ever sent anything. */
  getPlayer(player: number): Readonly<PlayerState> | undefined {
    return this.players.get(player);
  }

  /**
   * Two pointers for this scene: player 1 = controller (+ Space), player 2 = mouse.
   * Call setSplit(null) when leaving (also done automatically when the scene shuts down).
   */
  setSplit(scene: Scene | null) {
    this.setSplitHover(undefined);
    this.splitScene = scene ?? undefined;
    this.ui?.setSplit(!!scene);
    scene?.events.once('shutdown', () => {
      if (this.splitScene === scene) this.setSplit(null);
    });
  }

  /** Make the current position of every connected controller the center / neutral position (key C). */
  calibrate() {
    let count = 0;
    for (const state of this.players.values()) {
      if (!this.isFresh(state)) continue;
      setCenter(state, state.x, state.y, state.z);
      count++;
    }
    this.stopRecenter();
    this.resetMotion();
    this.ui?.flash(count > 0 ? 'calibrated' : 'no controller data');
  }

  /**
   * "Point at the star": shows a star in the middle of the screen. As soon as
   * player 1's controller is held still for a moment, that becomes the center.
   * Call this at the start of every minigame. Does nothing without a
   * controller, or in 'rate' mode. The star only shows while the controller
   * is in use, and goes away when the scene ends.
   */
  startRecenter(scene?: Scene) {
    if (CFG.CONTROL_MODE !== 'point' || this.controllers.size === 0) return;
    // The Nunchuk can't "point at the star" (no gyro): only needed when not every controller is a Nunchuk.
    const known = [...this.players.values()];
    if (known.length > 0 && known.every((state) => state.type === 'nunchuk')) return;
    this.recentering = true;
    this.stillSamples.clear();
    this.centered.clear();
    scene?.events.once('shutdown', () => this.stopRecenter());
  }

  /** Forget the min/max pitch/yaw seen so far (key R; shown in the debug panel). */
  resetRange() {
    this.range = emptyRange();
    this.ui?.flash('range reset');
  }

  /** Switch between mouse and controller by hand (key T). */
  toggleMode() {
    if (this.mode === 'tilt') {
      this.preferMouse = true;
      this.setMode('mouse');
    } else if (this.isFresh(this.players.get(TILT_PLAYER))) {
      this.preferMouse = false;
      this.setMode('tilt');
    } else {
      this.ui?.flash('no controller data');
    }
  }

  /** A player's button: player 1 = Space or the controller button, player 2 = player 2's controller button. */
  pressPlayerButton(player = TILT_PLAYER) {
    if (player === MOUSE_PLAYER) {
      this.pressPlayer2Button();
      return;
    }
    if (this.mode !== 'tilt' || player !== TILT_PLAYER) return;
    // Not this player's turn: the mouse has the pointer.
    if (!this.splitScene && this.mouseOwnsPointer()) return;

    if (this.splitScene) {
      // Press whatever is under player 1's pointer, like a click would.
      this.pressAt(this.splitScene, this.cursor);
    } else {
      // One pointer: same as a click at the tilt cursor.
      this.sendMouseEvent('mousedown');
      this.sendMouseEvent('mouseup');
    }
    this.emit('select', { ...this.cursor, player: TILT_PLAYER });
  }

  /** Player 2's controller button: a mouse click at player 2's controller cursor (player 2 = the mouse). */
  private pressPlayer2Button() {
    if (!this.player2DrivesPointer()) return;
    this.clickAsPlayer2();
  }

  private clickAsPlayer2(button = 0) {
    const at = this.motion[2].cursor;
    this.sendMouseEvent('mousedown', button, at);
    this.sendMouseEvent('mouseup', button, at);
    this.emit('select', { ...at, player: this.splitScene ? MOUSE_PLAYER : undefined });
  }

  /** Is player 2's controller in use (sending data, and not switched to the mouse with T)? */
  private player2Active(): boolean {
    return !this.preferMouse && this.isFresh(this.players.get(MOUSE_PLAYER));
  }

  /**
   * Does player 2's controller move the mouse pointer right now? Wherever player 2 has the mouse:
   * on two-player screens, when it is player 2's turn, and on screens without player 1's controller.
   */
  private player2DrivesPointer(): boolean {
    return this.player2Active() && (!!this.splitScene || this.mouseOwnsPointer() || this.mode === 'mouse');
  }

  // ---------------------------------------------------------------------------
  // Mouse
  // ---------------------------------------------------------------------------

  private onRealMouse = (event: MouseEvent) => {
    if (this.synthetic.has(event)) return; // our own event: let Phaser handle it
    if (event.target instanceof Element && event.target.closest(`[${UI_ATTRIBUTE}]`)) return; // our buttons

    // Player 2's controller has the mouse pointer: the real mouse doesn't move it;
    // a real click still counts, at player 2's controller cursor.
    if (this.player2DrivesPointer()) {
      event.stopImmediatePropagation();
      if (event.type === 'mouseup' && event.target === this.canvas) this.clickAsPlayer2(event.button);
      return;
    }

    this.mouse = this.toGame(event.clientX, event.clientY);
    const onGame = event.target === this.canvas;

    // Mouse mode, or split mode (mouse = player 2): normal mouse, just report clicks.
    if (this.mode === 'mouse' || this.splitScene || this.mouseOwnsPointer()) {
      if (event.type === 'mouseup' && onGame) {
        this.emit('select', { ...this.mouse, player: this.splitScene ? MOUSE_PLAYER : undefined });
      }
      return;
    }

    // Tilt mode with one pointer: the real mouse position is ignored...
    event.stopImmediatePropagation();
    // ...and clicks happen where the tilt cursor is.
    if (event.type === 'mousedown' || event.type === 'mouseup') {
      this.sendMouseEvent(event.type, event.button);
      if (event.type === 'mouseup') this.emit('select', { ...this.cursor, player: TILT_PLAYER });
    }
  };

  /** Send a mouse event to the canvas at a point (default: the tilt cursor), as if the mouse were there. */
  private sendMouseEvent(type: 'mousemove' | 'mousedown' | 'mouseup', button = 0, at: Point = this.cursor) {
    const canvas = this.canvas;
    if (!canvas) return;
    const { x, y } = this.toClient(at);
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
      button,
      buttons: type === 'mousedown' ? 1 : 0,
    });
    this.synthetic.add(event);
    canvas.dispatchEvent(event);
  }

  // ---------------------------------------------------------------------------
  // Split mode: hit-test player 1's pointer against the scene's interactive objects
  // ---------------------------------------------------------------------------

  /** The top interactive object under a point (game coordinates), if any. */
  hitTest(scene: Scene, point: Point): GameObjects.GameObject | undefined {
    const manager = scene.input.manager;
    const camera = scene.cameras.main;
    const pointer = this.fakePointer(scene, point);

    // Front to back: highest depth first, then the one drawn last.
    const candidates = scene.children.list
      .map((object, index) => ({ object, index }))
      .filter(({ object }) => object.input?.enabled && object.active)
      .sort((a, b) => depthOf(b.object) - depthOf(a.object) || b.index - a.index);

    for (const { object } of candidates) {
      if (manager.hitTest(pointer, [object], camera).length > 0) return object;
    }
    return undefined;
  }

  /**
   * A click at a point, like a real mouse click there: the object under it gets
   * pointerdown/pointerup, and then the scene itself (unless the object stopped
   * it with event.stopPropagation(), like a real Phaser click).
   */
  pressAt(scene: Scene, point: Point): GameObjects.GameObject | undefined {
    const object = this.hitTest(scene, point);
    const pointer = this.fakePointer(scene, point);
    const eventData = {
      cancelled: false,
      stopPropagation() {
        this.cancelled = true;
      },
    };
    object?.emit('pointerdown', pointer, 0, 0, eventData);
    object?.emit('pointerup', pointer, 0, 0, eventData);
    if (!eventData.cancelled) {
      const over = object ? [object] : [];
      scene.input.emit('pointerdown', pointer, over);
      scene.input.emit('pointerup', pointer, over);
    }
    return object;
  }

  private fakePointer(scene: Scene, point: Point): Input.Pointer {
    const pointer = new Input.Pointer(scene.input.manager, 99);
    // Pointer positions are in canvas pixels; game coordinates are scaled by the camera zoom.
    const zoom = scene.cameras.main.zoom;
    pointer.x = point.x * zoom;
    pointer.y = point.y * zoom;
    pointer.worldX = point.x;
    pointer.worldY = point.y;
    return pointer;
  }

  /** Hover for player 1 in split mode: pointerover / pointerout on what's under the pointer. */
  private setSplitHover(object: GameObjects.GameObject | undefined) {
    if (object === this.splitHover) return;
    const scene = this.splitScene;
    if (this.splitHover && scene) this.splitHover.emit('pointerout', this.fakePointer(scene, this.cursor));
    this.splitHover = object;
    if (object && scene) object.emit('pointerover', this.fakePointer(scene, this.cursor), 0, 0, { stopPropagation() {} });
  }

  private toGame(clientX: number, clientY: number): Point {
    const rect = this.canvas?.getBoundingClientRect();
    if (!rect || rect.width === 0) return { ...this.mouse };
    return {
      x: ((clientX - rect.left) / rect.width) * GAME_WIDTH,
      y: ((clientY - rect.top) / rect.height) * GAME_HEIGHT,
    };
  }

  private toClient(point: Point): Point {
    const rect = this.canvas?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: rect.left + (point.x / GAME_WIDTH) * rect.width,
      y: rect.top + (point.y / GAME_HEIGHT) * rect.height,
    };
  }

  // ---------------------------------------------------------------------------
  // Keys
  // ---------------------------------------------------------------------------

  private onKey = (event: KeyboardEvent) => {
    // Leave browser shortcuts (Cmd+C, Ctrl+D, ...) alone.
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;

    const key = event.key.toLowerCase();
    if (key === 't') this.toggleMode();
    else if (key === 'c') this.calibrate();
    else if (key === 'r') this.resetRange();
    else if (key === 'd') {
      this.ui?.toggleDebug();
      this.lastDebug = 0;
    } else if (key === ' ') {
      event.preventDefault(); // don't scroll the page
      this.pressPlayerButton(TILT_PLAYER);
    }
  };

  // ---------------------------------------------------------------------------
  // Serial
  // ---------------------------------------------------------------------------

  /** Called by the "Connect controller" button (needs a click: browser rule). */
  private async requestController() {
    try {
      const port = await navigator.serial!.requestPort();
      await this.openPort(port);
    } catch (error) {
      // NotFoundError = the player closed the port picker: not a problem.
      if (!(error instanceof DOMException && error.name === 'NotFoundError')) {
        console.warn('[controller] could not connect:', error);
        this.ui?.flash('could not connect');
      }
    }
  }

  /** Reconnect to ports this page was allowed to use before (no click needed). */
  private async reconnectKnownPorts() {
    try {
      const ports = await navigator.serial!.getPorts();
      await Promise.all(ports.map((port) => this.openPort(port)));
    } catch (error) {
      console.warn('[controller] could not reconnect:', error);
    }
  }

  private async openPort(port: SerialPort) {
    if ([...this.controllers].some((c) => c.port === port)) return; // already open

    const controller = new SerialController(port, {
      onMessage: (message) => this.onMessage(message, controller),
      onClose: () => {
        this.controllers.delete(controller);
        this.ui?.setConnected(this.controllers.size);
        this.ui?.flash(controller.player ? `controller P${controller.player} disconnected` : 'controller disconnected');
      },
    });
    this.controllers.add(controller);

    try {
      await controller.open(CFG.BAUD_RATE);
      this.ui?.setConnected(this.controllers.size);
      this.ui?.flash(`controller ${this.controllers.size} connected`);
    } catch (error) {
      // E.g. the port is open in another tab or in the Arduino Serial Monitor.
      this.controllers.delete(controller);
      console.warn('[controller] could not open port:', error);
      this.ui?.flash('port busy? close Serial Monitor');
    }
  }

  private closePort(port: SerialPort) {
    for (const controller of this.controllers) {
      if (controller.port === port) void controller.close();
    }
  }

  /**
   * Which player a controller (port) is: the "p" of its first message, unless another connected
   * controller already is that player; then it becomes the other one (so two controllers that
   * both say PLAYER = 1 still become player 1 and 2). Stays the same while it is connected.
   */
  private playerFor(controller: SerialController, wanted: unknown): ControllerPlayer | undefined {
    if (controller.player) return controller.player;
    if (wanted !== 1 && wanted !== 2) return undefined;
    const taken = (player: ControllerPlayer) => [...this.controllers].some((c) => c !== controller && c.player === player);
    const player: ControllerPlayer = taken(wanted) ? (wanted === 1 ? 2 : 1) : wanted;
    if (taken(player)) return undefined; // already two controllers
    controller.player = player;
    if (player !== wanted) console.info(`[controller] says player ${wanted}, but that one is taken: it is player ${player}`);
    this.ui?.flash(`controller = P${player}`);
    return player;
  }

  private onMessage(message: ControllerMessage, controller: SerialController) {
    if (typeof message.info === 'string') {
      console.info('[controller]', message.info);
      return;
    }
    if (typeof message.error === 'string') {
      console.warn('[controller]', message.error);
      return;
    }

    const { x, y } = message;
    const p = this.playerFor(controller, message.p);
    if (p === undefined || typeof x !== 'number' || typeof y !== 'number') return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const z = typeof message.z === 'number' && Number.isFinite(message.z) ? message.z : 0;
    const type: ControllerType = 'jx' in message ? 'nunchuk' : 'mpu';
    const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

    const now = performance.now();
    this.messageCount++;

    let state = this.players.get(p);
    // First data from this controller, or first after a gap: (re)calibrate.
    const freshStart = !state || now - state.lastSeen > CFG.TIMEOUT_MS;
    if (!state) {
      state = {
        player: p, type, jx: 0, jy: 0, bc: false, bz: false,
        x, y, z, shake: false, btn: false, neutralX: x, neutralY: y, neutralZ: z, lastSeen: now,
      };
      this.players.set(p, state);
    }
    if (state.type !== type) {
      state.type = type;
      this.resetMotion(p);
      this.ui?.setControllerType(type, p);
      // The Nunchuk can't "point at the star" (no gyro).
      if (type === 'nunchuk' && this.recentering) this.finishRecenter(p);
    }
    if (freshStart) {
      setCenter(state, x, y, z);
      if (p === TILT_PLAYER) this.preferMouse = false;
      // Player 2's controller takes over the mouse pointer where it is now.
      this.resetMotion(p, p === MOUSE_PLAYER ? { ...this.mouse } : undefined);
      this.ui?.setControllerType(type, p);
    }

    const shake = message.shake === 1;
    const btn = message.btn === 1;
    // Nunchuk buttons: "bc"/"bz", or "c"/"z" in older sketches.
    const bc = message.bc === 1 || message.c === 1;
    const bz = message.bz === 1 || message.z === 1;
    if (shake && !state.shake) this.emit('shake', { player: p });
    // The "click": the MPU's button, or the Nunchuk's Z (its btn is a copy of Z, so it is not used).
    const zDown = type === 'nunchuk' && bz && !state.bz;
    const click = type === 'nunchuk' ? zDown : btn && !state.btn;
    // Short "Z" in the label, so you can see that the game receives the button.
    if (zDown) this.ui?.flash('Z');
    // C only gives a separate "back" signal (not used yet).
    if (type === 'nunchuk' && bc && !state.bc) this.emit('back', { player: p });
    if (click) {
      this.emit('button', { player: p });
      this.pressPlayerButton(p);
    }

    state.jx = num(message.jx);
    state.jy = num(message.jy);
    state.bc = bc;
    state.bz = bz;
    state.x = x;
    state.y = y;
    state.z = z;
    state.shake = shake;
    state.btn = btn;
    state.lastSeen = now;

    if (p === TILT_PLAYER && this.mode === 'mouse' && !this.preferMouse) this.setMode('tilt');
    if (this.recentering && type === 'mpu' && this.controllerInUse(p) && !this.centered.has(p)) this.checkStill(state, now);
  }

  /** Is this player's controller in use right now? */
  private controllerInUse(player: ControllerPlayer): boolean {
    return player === TILT_PLAYER ? this.mode === 'tilt' : this.player2Active();
  }

  // ---------------------------------------------------------------------------
  // Star recentering ("point at the star")
  // ---------------------------------------------------------------------------

  /** Recenter a controller as soon as it has been (almost) still for STILL_TIME (each player on their own). */
  private checkStill(state: PlayerState, now: number) {
    const { STILL_TIME, STILL_TOLERANCE } = CFG.RECENTER;
    const player = state.player as ControllerPlayer;
    let samples = this.stillSamples.get(player) ?? [];
    const pitch = state[CFG.POINT.PITCH_AXIS];
    // Yaw relative to the first sample, unwrapped, so ±180° doesn't count as a big jump.
    const first = samples[0];
    const yaw = first ? first.yaw + wrapDegrees(state.z - first.yaw) : state.z;
    samples.push({ time: now, pitch, yaw });

    // Moved too much? Start counting again from here.
    const moved = samples.some((s) => Math.abs(s.pitch - pitch) > STILL_TOLERANCE || Math.abs(s.yaw - yaw) > STILL_TOLERANCE);
    if (moved) samples = [{ time: now, pitch, yaw }];
    this.stillSamples.set(player, samples);
    if (moved || now - samples[0].time < STILL_TIME) return;

    // Held still long enough: the average of this moment is the new center.
    const avg = (key: 'pitch' | 'yaw') => samples.reduce((sum, s) => sum + s[key], 0) / samples.length;
    const centerPitch = avg('pitch');
    setCenter(
      state,
      CFG.POINT.PITCH_AXIS === 'x' ? centerPitch : state.x,
      CFG.POINT.PITCH_AXIS === 'y' ? centerPitch : state.y,
      wrapDegrees(avg('yaw')),
    );
    this.resetMotion(player);
    this.ui?.flash(`P${player} calibrated`);
    this.finishRecenter(player);
  }

  /** This player is done with the star; when every controller in use is done, the star goes away. */
  private finishRecenter(player: ControllerPlayer) {
    this.centered.add(player);
    this.stillSamples.delete(player);
    const waiting = CONTROLLER_PLAYERS.some(
      (p) => this.controllerInUse(p) && this.players.get(p)?.type === 'mpu' && !this.centered.has(p),
    );
    if (!waiting) this.stopRecenter();
  }

  private stopRecenter() {
    this.recentering = false;
    this.stillSamples.clear();
    this.centered.clear();
  }

  /**
   * After a new center: start the cursor movement fresh (no jump from old filter values).
   * One player, or both; `cursor` = where that player's cursor starts (default: where it is).
   */
  private resetMotion(player?: ControllerPlayer, cursor?: Point) {
    for (const p of player ? [player] : CONTROLLER_PLAYERS) {
      this.motion[p] = newMotion(cursor ?? this.motion[p].cursor);
    }
  }

  private isFresh(state: PlayerState | undefined): state is PlayerState {
    return !!state && performance.now() - state.lastSeen <= CFG.TIMEOUT_MS;
  }

  // ---------------------------------------------------------------------------
  // Mode and movement
  // ---------------------------------------------------------------------------

  private setMode(mode: InputMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.resetMotion(TILT_PLAYER);
    if (mode === 'mouse') this.setSplitHover(undefined);
    // A running "point at the star" waits until the controller is back.
    if (mode === 'tilt' && !this.splitScene) this.sendMouseEvent('mousemove');

    this.ui?.setMode(mode);
    this.emit('modechange', mode);
  }

  /** Every frame. */
  private update() {
    const now = performance.now();
    const frame = now - this.lastFrame;
    this.lastFrame = now;
    // After a long frame (page was busy), serial data may still be waiting: don't time out yet.
    const stalled = frame > STALL_MS;
    const dt = Math.min(frame, 100) / 1000;

    if (this.mode === 'tilt' && !stalled && !this.isFresh(this.players.get(TILT_PLAYER))) this.setMode('mouse');
    if (this.mode === 'tilt') this.moveCursor(dt);

    // Player 2's controller: starts or stops (not while the page was busy), and moves the mouse pointer.
    const player2 = this.player2Active() || (stalled && this.player2WasActive);
    if (player2 !== this.player2WasActive) {
      this.player2WasActive = player2;
      if (!player2) this.ui?.setControllerType(undefined, MOUSE_PLAYER);
    }
    if (player2) this.movePlayer2Cursor(dt);

    this.updatePointers();
    this.updateDebug(now);
  }

  /** Where a controller wants its cursor (point or rate mode, see CONTROL_MODE in controllerConfig.ts). */
  private targetFor(state: PlayerState, m: Motion, dt: number): Point {
    if (state.type === 'nunchuk') {
      return CFG.NUNCHUK_CONTROL === 'tilt' ? this.nunchukTiltTarget(state, m, dt) : this.joystickTarget(state, m, dt);
    }
    return CFG.CONTROL_MODE === 'point' ? this.pointTarget(state, m, dt) : this.rateTarget(state, m, dt);
  }

  /** Move the tilt cursor (player 1). */
  private moveCursor(dt: number) {
    const state = this.players.get(TILT_PLAYER);
    if (!state || dt <= 0) return;

    const next = this.clamp(this.targetFor(state, this.motion[1], dt));
    if (Math.abs(next.x - this.cursor.x) < 0.01 && Math.abs(next.y - this.cursor.y) < 0.01) return;
    this.cursor = next;

    if (this.splitScene) {
      this.setSplitHover(this.hitTest(this.splitScene, this.cursor));
    } else if (!this.mouseOwnsPointer()) {
      this.sendMouseEvent('mousemove');
    }
    this.emit('cursormove', { player: TILT_PLAYER, ...this.cursor });
  }

  /**
   * Move player 2's controller cursor. Player 2 is the mouse, so where player 2 has the mouse,
   * the mouse pointer goes with it (scenes see normal mouse moves).
   */
  private movePlayer2Cursor(dt: number) {
    const state = this.players.get(MOUSE_PLAYER);
    const m = this.motion[2];
    if (!state || dt <= 0) return;

    const next = this.clamp(this.targetFor(state, m, dt));
    if (Math.abs(next.x - m.cursor.x) < 0.01 && Math.abs(next.y - m.cursor.y) < 0.01) return;
    m.cursor = next;
    if (!this.player2DrivesPointer()) return;
    this.mouse = { ...next };
    this.sendMouseEvent('mousemove', 0, next);
  }

  /**
   * Point mode, like a Wii remote: where the controller points is where the cursor goes.
   * Up/down from a tilt angle (PITCH_AXIS), left/right from the gyro rotation (z).
   */
  private pointTarget(state: PlayerState, m: Motion, dt: number): Point {
    const P = CFG.POINT;
    // Min/max for tuning are only kept for player 1.
    const { pitch, yaw } = state.player === TILT_PLAYER ? this.pointAngles(state) : this.relativeAngles(state);

    // Jitter filter: quick small changes (< DEAD_ZONE) are ignored; bigger ones are followed.
    // When held still, it slowly settles on the real value, so no offset of DEAD_ZONE stays behind.
    const settle = 1 - Math.exp(-dt / JITTER_SETTLE_TIME);
    m.held.pitch = followBeyond(m.held.pitch, pitch, P.DEAD_ZONE);
    m.held.yaw = followBeyond(m.held.yaw, yaw, P.DEAD_ZONE);
    m.held.pitch += (pitch - m.held.pitch) * settle;
    m.held.yaw += (yaw - m.held.yaw) * settle;

    const target = {
      x: GAME_WIDTH / 2 + (m.held.yaw / P.YAW_RANGE) * (GAME_WIDTH / 2),
      y: GAME_HEIGHT / 2 - (m.held.pitch / P.PITCH_RANGE) * (GAME_HEIGHT / 2),
    };

    const follow = P.SMOOTHING > 0 ? 1 - Math.exp(-dt / P.SMOOTHING) : 1;
    return {
      x: m.cursor.x + (target.x - m.cursor.x) * follow,
      y: m.cursor.y + (target.y - m.cursor.y) * follow,
    };
  }

  /** Pitch and yaw in degrees from the center (after the INVERT settings). Also tracks min/max for tuning. */
  private pointAngles(state: PlayerState): { pitch: number; yaw: number } {
    const { pitch, yaw } = this.relativeAngles(state);
    this.range.minPitch = Math.min(this.range.minPitch, pitch);
    this.range.maxPitch = Math.max(this.range.maxPitch, pitch);
    this.range.minYaw = Math.min(this.range.minYaw, yaw);
    this.range.maxYaw = Math.max(this.range.maxYaw, yaw);
    return { pitch, yaw };
  }

  /** Pitch/yaw in degrees from the center, after the INVERT settings (yaw wrapped to ±180°). */
  private relativeAngles(state: PlayerState): { pitch: number; yaw: number } {
    const P = CFG.POINT;
    const axis = P.PITCH_AXIS;
    const pitch = state[axis] - (axis === 'x' ? state.neutralX : state.neutralY);
    const yaw = wrapDegrees(state.z - state.neutralZ);
    return { pitch: P.INVERT_PITCH ? -pitch : pitch, yaw: P.INVERT_YAW ? -yaw : yaw };
  }

  /**
   * Nunchuk tilt: the cursor follows the tilt (absolute, like pointing).
   * Left/right from y (tilt left/right), up/down from x (tilt forward/back),
   * relative to the middle (set when the Nunchuk connects, and with key C).
   */
  private nunchukTiltTarget(state: PlayerState, m: Motion, dt: number): Point {
    const T = CFG.NUNCHUK_TILT;
    let { leftRight, forwardBack } = tiltFromCenter(state);
    if (T.INVERT_X) leftRight = -leftRight;
    if (T.INVERT_Y) forwardBack = -forwardBack;

    // 1-euro filter: calm when still, quick when moving.
    const lr = m.tiltFilter.x.filter(leftRight, dt, T.MIN_CUTOFF, T.BETA);
    const fb = m.tiltFilter.y.filter(forwardBack, dt, T.MIN_CUTOFF, T.BETA);

    return {
      x: GAME_WIDTH / 2 + (lr / T.RANGE_X) * (GAME_WIDTH / 2),
      y: GAME_HEIGHT / 2 - (fb / T.RANGE_Y) * (GAME_HEIGHT / 2),
    };
  }

  /** Nunchuk: the joystick sets the speed of the cursor (rate control). */
  private joystickTarget(state: PlayerState, m: Motion, dt: number): Point {
    const speed = (value: number) => {
      const size = Math.abs(value);
      if (size <= CFG.NUNCHUK_DEAD_ZONE) return 0;
      const amount = Math.min((size - CFG.NUNCHUK_DEAD_ZONE) / (100 - CFG.NUNCHUK_DEAD_ZONE), 1);
      return Math.sign(value) * amount * CFG.NUNCHUK_MAX_SPEED;
    };
    // Joystick up is positive, screen y goes down.
    const vy = -speed(state.jy) * (CFG.NUNCHUK_INVERT_Y ? -1 : 1);
    const follow = CFG.NUNCHUK_SMOOTHING > 0 ? 1 - Math.exp(-dt / CFG.NUNCHUK_SMOOTHING) : 1;
    m.velocity.x += (speed(state.jx) - m.velocity.x) * follow;
    m.velocity.y += (vy - m.velocity.y) * follow;
    return { x: m.cursor.x + m.velocity.x * dt, y: m.cursor.y + m.velocity.y * dt };
  }

  /** Rate mode, like a joystick: the tilt sets the speed of the cursor. */
  private rateTarget(state: PlayerState, m: Motion, dt: number): Point {
    const R = CFG.RATE;
    // Sensor y = tilt left/right -> screen x; sensor x = tilt forward/back -> screen y.
    let tiltX = state.y - state.neutralY;
    let tiltY = state.x - state.neutralX;
    if (R.SWAP_AXES) [tiltX, tiltY] = [tiltY, tiltX];
    if (R.INVERT_X) tiltX = -tiltX;
    if (R.INVERT_Y) tiltY = -tiltY;

    const follow = R.SMOOTHING > 0 ? 1 - Math.exp(-dt / R.SMOOTHING) : 1;
    m.velocity.x += (speedFor(tiltX) - m.velocity.x) * follow;
    m.velocity.y += (speedFor(tiltY) - m.velocity.y) * follow;
    return { x: m.cursor.x + m.velocity.x * dt, y: m.cursor.y + m.velocity.y * dt };
  }

  /**
   * The arrow at the tilt cursor, for screens that draw no cursor of their own.
   * (Screens with the players' hands or tools hide the system cursor; they draw
   * their own, see src/playerPointers.ts.)
   */
  private updatePointers() {
    const ui = this.ui;
    const canvas = this.canvas;
    if (!ui || !canvas) return;
    const tip = this.toClient(this.cursor);
    const sceneHasOwnCursor = canvas.style.cursor === 'none';
    ui.setArrow(tip.x, tip.y, this.mode === 'tilt' && !this.splitScene && !this.mouseOwnsPointer() && !sceneHasOwnCursor);

    // "Point at the star", in the middle of the game.
    const middle = this.toClient({ x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 });
    const height = canvas.getBoundingClientRect().height;
    // Only for an MPU-6050 that still has to point at it (the Nunchuk has no gyro: never a star for it).
    const waiting = CONTROLLER_PLAYERS.some(
      (p) => this.controllerInUse(p) && this.players.get(p)?.type === 'mpu' && !this.centered.has(p),
    );
    ui.setStar(middle.x, middle.y, height, CFG.RECENTER.TEXT, this.recentering && waiting);
  }

  /** Is this scene in split mode (player 1 on the controller, player 2 on the mouse)? */
  /**
   * On a one-pointer screen: give the pointer to a player, e.g. whose turn it is.
   * setPointerOwner(2) = the mouse (player 2) controls it, the controller is ignored;
   * setPointerOwner(1) or undefined = the controller (if connected), as usual.
   */
  setPointerOwner(player: number | undefined) {
    if (player === this.pointerOwner) return;
    this.pointerOwner = player;
    // Back to the controller: put the pointer where the controller is.
    if (this.mode === 'tilt' && !this.splitScene && !this.mouseOwnsPointer()) this.sendMouseEvent('mousemove');
  }

  private mouseOwnsPointer(): boolean {
    return this.pointerOwner === MOUSE_PLAYER;
  }

  isSplit(scene: Scene): boolean {
    return this.splitScene === scene;
  }

  private clamp(point: Point): Point {
    return {
      x: Math.min(Math.max(point.x, 0), GAME_WIDTH - 1),
      y: Math.min(Math.max(point.y, 0), GAME_HEIGHT - 1),
    };
  }

  private updateDebug(now: number) {
    if (now - this.rateStart >= 1000) {
      this.messagesPerSecond = Math.round((this.messageCount * 1000) / (now - this.rateStart));
      this.messageCount = 0;
      this.rateStart = now;
    }
    if (!this.ui?.debugVisible || now - this.lastDebug < DEBUG_REFRESH_MS) return;
    this.lastDebug = now;

    const p1 = this.players.get(TILT_PLAYER);
    const nunchuk = p1?.type === 'nunchuk';
    const lines = [
      `mode      ${this.mode}${this.preferMouse ? ' (mouse chosen with T)' : ''}${this.splitScene ? '   split: P1 controller, P2 mouse' : ''}`,
      `control   ${p1 ? (nunchuk ? `Nunchuk (${CFG.NUNCHUK_CONTROL})` : `MPU-6050 (${CFG.CONTROL_MODE})`) : CFG.CONTROL_MODE}` +
        (this.recentering ? '   waiting: point at the star' : ''),
      `ports     ${this.controllers.size}   ${this.messagesPerSecond} msg/s`,
      `cursor    ${this.cursor.x.toFixed(0)}, ${this.cursor.y.toFixed(0)}` +
        (nunchuk || CFG.CONTROL_MODE === 'rate' ? `   speed ${this.motion[1].velocity.x.toFixed(0)}, ${this.motion[1].velocity.y.toFixed(0)}` : ''),
      `mouse     ${this.mouse.x.toFixed(0)}, ${this.mouse.y.toFixed(0)}` +
        (this.player2Active() ? `   (P2 controller${this.player2DrivesPointer() ? ' moves it' : ''})` : ''),
    ];

    if (p1 && !nunchuk && CFG.CONTROL_MODE === 'point') {
      const { pitch, yaw } = this.relativeAngles(p1);
      const r = this.range;
      const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(1).padStart(6) : '     -');
      lines.push(
        `pitch     ${fmt(pitch)}°  (axis ${CFG.POINT.PITCH_AXIS}, range ±${CFG.POINT.PITCH_RANGE})   min ${fmt(r.minPitch)}  max ${fmt(r.maxPitch)}`,
        `yaw       ${fmt(yaw)}°  (z, range ±${CFG.POINT.YAW_RANGE})        min ${fmt(r.minYaw)}  max ${fmt(r.maxYaw)}`,
      );
    }

    if (this.players.size === 0) lines.push('no controller data yet');
    for (const s of [...this.players.values()].sort((a, b) => a.player - b.player)) {
      const age = now - s.lastSeen;
      const seen = age > CFG.TIMEOUT_MS ? 'no data' : `${age.toFixed(0)} ms ago`;
      if (s.type === 'nunchuk') {
        lines.push(
          `P${s.player} nunchuk  joy ${String(s.jx).padStart(4)}, ${String(s.jy).padStart(4)}  C ${s.bc ? 1 : 0}  Z ${s.bz ? 1 : 0}  shake ${s.shake ? 1 : 0}`,
          `          tilt x ${s.x.toFixed(1)}  y ${s.y.toFixed(1)}   from middle: ` +
            `left/right ${tiltFromCenter(s).leftRight.toFixed(1)}  forward/back ${tiltFromCenter(s).forwardBack.toFixed(1)}   ${seen}`,
        );
      } else {
        lines.push(
          `P${s.player} mpu      x ${s.x.toFixed(1)}  y ${s.y.toFixed(1)}  z ${s.z.toFixed(1)}  shake ${s.shake ? 1 : 0}  btn ${s.btn ? 1 : 0}`,
          `          center ${s.neutralX.toFixed(1)}, ${s.neutralY.toFixed(1)}, ${s.neutralZ.toFixed(1)}   ${seen}`,
        );
      }
    }
    lines.push('', 'T mouse/controller  C center  R reset min/max  Space P1 button  D close');
    this.ui.setDebugText(lines.join('\n'));
  }
}

/** Rate mode: tilt (degrees) -> cursor speed (px/s), with a dead zone and a maximum. */
function speedFor(tilt: number): number {
  const { DEAD_ZONE, MAX_ANGLE, MAX_SPEED } = CFG.RATE;
  const size = Math.abs(tilt);
  if (size <= DEAD_ZONE) return 0;
  const amount = Math.min((size - DEAD_ZONE) / (MAX_ANGLE - DEAD_ZONE), 1);
  return Math.sign(tilt) * amount * MAX_SPEED;
}

/** An angle difference in -180..180 degrees (so 179° -> -179° is a step of 2°, not 358°). */
function wrapDegrees(angle: number): number {
  return ((((angle + 180) % 360) + 360) % 360) - 180;
}

/**
 * Jitter filter: `held` only moves when `value` gets more than `deadZone` away
 * from it, and then follows at that distance. Small trembling is ignored, real
 * movement is followed smoothly.
 */
function followBeyond(held: number, value: number, deadZone: number): number {
  if (value > held + deadZone) return value - deadZone;
  if (value < held - deadZone) return value + deadZone;
  return held;
}

/**
 * Nunchuk: how far (degrees) it is tilted left/right and forward/back from the
 * center (set with C). Computed from the direction of gravity, so it is
 * accurate however the Nunchuk is held (the raw roll angle is not, when the
 * Nunchuk is held on its side), and the two directions don't mix.
 */
function tiltFromCenter(state: PlayerState): { leftRight: number; forwardBack: number } {
  const g = gravity(state.x, state.y);
  const g0 = gravity(state.neutralX, state.neutralY);
  // Axis "tilt left/right" = turning around the Nunchuk's forward axis (0, 1, 0).
  const lrAxis = normalize(cross([0, 1, 0], g0));
  if (!lrAxis) {
    // Held with the front straight up or down: fall back to the plain angles.
    return { leftRight: wrapDegrees(state.y - state.neutralY), forwardBack: wrapDegrees(state.x - state.neutralX) };
  }
  const fbAxis = cross(g0, lrAxis);
  const deg = (v: number) => (Math.asin(Math.max(-1, Math.min(1, v))) * 180) / Math.PI;
  return { leftRight: deg(dot(g, lrAxis)), forwardBack: deg(dot(g, fbAxis)) };
}

type Vec3 = [number, number, number];

/** Direction of gravity from the Nunchuk sketch's angles (x = pitch, y = roll, degrees). */
function gravity(pitchDeg: number, rollDeg: number): Vec3 {
  const p = (pitchDeg * Math.PI) / 180;
  const r = (rollDeg * Math.PI) / 180;
  return [Math.cos(p) * Math.sin(r), Math.sin(p), Math.cos(p) * Math.cos(r)];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(v: Vec3): Vec3 | undefined {
  const length = Math.hypot(v[0], v[1], v[2]);
  return length < 0.1 ? undefined : [v[0] / length, v[1] / length, v[2] / length];
}

/**
 * "1-euro filter" (Casiez et al.): smooths a shaky signal strongly when it
 * changes slowly, and lightly when it changes fast, so it is both calm and quick.
 */
class OneEuroFilter {
  private value?: number;
  private speed = 0;

  filter(input: number, dt: number, minCutoff: number, beta: number, speedCutoff = 1): number {
    if (this.value === undefined || dt <= 0) {
      this.value = input;
      return input;
    }
    const alpha = (cutoff: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
    this.speed += alpha(speedCutoff) * ((input - this.value) / dt - this.speed);
    this.value += alpha(minCutoff + beta * Math.abs(this.speed)) * (input - this.value);
    return this.value;
  }
}

/** Set the center / neutral position of a controller. */
function setCenter(state: PlayerState, x: number, y: number, z: number) {
  state.neutralX = x;
  state.neutralY = y;
  state.neutralZ = z;
}

function emptyRange() {
  return { minPitch: Infinity, maxPitch: -Infinity, minYaw: Infinity, maxYaw: -Infinity };
}

function depthOf(object: GameObjects.GameObject): number {
  return (object as GameObjects.GameObject & { depth?: number }).depth ?? 0;
}

/** The one input manager for the whole game. */
export const inputManager = new InputManager();
