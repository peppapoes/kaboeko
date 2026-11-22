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
 * Use from anywhere:  import { inputManager } from './input/InputManager';
 *   inputManager.getCursor()        -> { x, y } of the main pointer, in game coordinates
 *   inputManager.getMode()          -> 'mouse' | 'tilt'
 *   inputManager.on('select', ({ x, y, player }) => ...)   a click
 *   inputManager.on('shake', ({ player }) => ...)          controller shaken (start of a shake)
 *   inputManager.on('button', ({ player }) => ...)         controller button pressed
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
export interface PlayerState {
  player: number;
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
/** In split mode, the mouse belongs to this player. */
const MOUSE_PLAYER = 2;

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

  private mouse: Point = { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 };
  private cursor: Point = { x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 };
  private velocity: Point = { x: 0, y: 0 };

  /** Point mode: pitch/yaw (degrees from the center) after the jitter filter. */
  private held = { pitch: 0, yaw: 0 };
  /** Point mode: smallest and largest pitch/yaw seen since the last reset (key R), for tuning. */
  private range = emptyRange();
  /** Star recentering: running while set; samples of the last STILL_TIME ms. */
  private recentering = false;
  private stillSamples: StillSample[] = [];

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

  /** Position of one player's pointer (split mode: 1 = controller, 2 = mouse). */
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
    this.recentering = true;
    this.stillSamples = [];
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

  /** Player 1's button (Space for now, later the controller button). */
  pressPlayerButton(player = TILT_PLAYER) {
    if (this.mode !== 'tilt' || player !== TILT_PLAYER) return;

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

  // ---------------------------------------------------------------------------
  // Mouse
  // ---------------------------------------------------------------------------

  private onRealMouse = (event: MouseEvent) => {
    if (this.synthetic.has(event)) return; // our own event: let Phaser handle it
    if (event.target instanceof Element && event.target.closest(`[${UI_ATTRIBUTE}]`)) return; // our buttons

    this.mouse = this.toGame(event.clientX, event.clientY);
    const onGame = event.target === this.canvas;

    // Mouse mode, or split mode (mouse = player 2): normal mouse, just report clicks.
    if (this.mode === 'mouse' || this.splitScene) {
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

  /** Send a mouse event to the canvas at the tilt cursor, as if the mouse were there. */
  private sendMouseEvent(type: 'mousemove' | 'mousedown' | 'mouseup', button = 0) {
    const canvas = this.canvas;
    if (!canvas) return;
    const { x, y } = this.toClient(this.cursor);
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

  /** Press the object under a point: fires its pointerdown/pointerup handlers. */
  pressAt(scene: Scene, point: Point): GameObjects.GameObject | undefined {
    const object = this.hitTest(scene, point);
    if (!object) return undefined;
    const pointer = this.fakePointer(scene, point);
    const eventData = { cancelled: false, stopPropagation() {} };
    object.emit('pointerdown', pointer, 0, 0, eventData);
    object.emit('pointerup', pointer, 0, 0, eventData);
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
      onMessage: (message) => this.onMessage(message),
      onClose: () => {
        this.controllers.delete(controller);
        this.ui?.setConnected(this.controllers.size);
        this.ui?.flash('controller disconnected');
      },
    });
    this.controllers.add(controller);

    try {
      await controller.open(CFG.BAUD_RATE);
      this.ui?.setConnected(this.controllers.size);
      this.ui?.flash('controller connected');
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

  private onMessage(message: ControllerMessage) {
    if (typeof message.info === 'string') {
      console.info('[controller]', message.info);
      return;
    }
    if (typeof message.error === 'string') {
      console.warn('[controller]', message.error);
      return;
    }

    const { p, x, y } = message;
    if (typeof p !== 'number' || typeof x !== 'number' || typeof y !== 'number') return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const z = typeof message.z === 'number' && Number.isFinite(message.z) ? message.z : 0;

    const now = performance.now();
    this.messageCount++;

    let state = this.players.get(p);
    // First data from this controller, or first after a gap: (re)calibrate.
    const freshStart = !state || now - state.lastSeen > CFG.TIMEOUT_MS;
    if (!state) {
      state = { player: p, x, y, z, shake: false, btn: false, neutralX: x, neutralY: y, neutralZ: z, lastSeen: now };
      this.players.set(p, state);
    }
    if (freshStart) {
      setCenter(state, x, y, z);
      if (p === TILT_PLAYER) {
        this.preferMouse = false;
        this.resetMotion();
      }
    }

    const shake = message.shake === 1;
    const btn = message.btn === 1;
    if (shake && !state.shake) this.emit('shake', { player: p });
    if (btn && !state.btn) {
      this.emit('button', { player: p });
      this.pressPlayerButton(p);
    }

    state.x = x;
    state.y = y;
    state.z = z;
    state.shake = shake;
    state.btn = btn;
    state.lastSeen = now;

    if (p === TILT_PLAYER && this.mode === 'mouse' && !this.preferMouse) this.setMode('tilt');
    if (p === TILT_PLAYER && this.recentering && this.mode === 'tilt') this.checkStill(state, now);
  }

  // ---------------------------------------------------------------------------
  // Star recentering ("point at the star")
  // ---------------------------------------------------------------------------

  /** Recenter as soon as the controller has been (almost) still for STILL_TIME. */
  private checkStill(state: PlayerState, now: number) {
    const { STILL_TIME, STILL_TOLERANCE } = CFG.RECENTER;
    const pitch = state[CFG.POINT.PITCH_AXIS];
    // Yaw relative to the first sample, unwrapped, so ±180° doesn't count as a big jump.
    const first = this.stillSamples[0];
    const yaw = first ? first.yaw + wrapDegrees(state.z - first.yaw) : state.z;
    this.stillSamples.push({ time: now, pitch, yaw });

    // Moved too much? Start counting again from here.
    const moved = this.stillSamples.some(
      (s) => Math.abs(s.pitch - pitch) > STILL_TOLERANCE || Math.abs(s.yaw - yaw) > STILL_TOLERANCE,
    );
    if (moved) {
      this.stillSamples = [{ time: now, pitch, yaw }];
      return;
    }
    if (now - this.stillSamples[0].time < STILL_TIME) return;

    // Held still long enough: the average of this moment is the new center.
    const avg = (key: 'pitch' | 'yaw') => this.stillSamples.reduce((sum, s) => sum + s[key], 0) / this.stillSamples.length;
    const centerPitch = avg('pitch');
    setCenter(
      state,
      CFG.POINT.PITCH_AXIS === 'x' ? centerPitch : state.x,
      CFG.POINT.PITCH_AXIS === 'y' ? centerPitch : state.y,
      wrapDegrees(avg('yaw')),
    );
    this.stopRecenter();
    this.resetMotion();
    this.ui?.flash('calibrated');
  }

  private stopRecenter() {
    this.recentering = false;
    this.stillSamples = [];
  }

  /** After a new center: start the cursor movement fresh (no jump from old filter values). */
  private resetMotion() {
    this.velocity = { x: 0, y: 0 };
    this.held = { pitch: 0, yaw: 0 };
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
    this.resetMotion();
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

    if (this.mode === 'tilt' && !stalled && !this.isFresh(this.players.get(TILT_PLAYER))) this.setMode('mouse');
    if (this.mode === 'tilt') this.moveCursor(Math.min(frame, 100) / 1000);

    this.updatePointers();
    this.updateDebug(now);
  }

  /** Move the tilt cursor (point or rate mode, see CONTROL_MODE in controllerConfig.ts). */
  private moveCursor(dt: number) {
    const state = this.players.get(TILT_PLAYER);
    if (!state || dt <= 0) return;

    const next = this.clamp(CFG.CONTROL_MODE === 'point' ? this.pointTarget(state, dt) : this.rateTarget(state, dt));
    if (Math.abs(next.x - this.cursor.x) < 0.01 && Math.abs(next.y - this.cursor.y) < 0.01) return;
    this.cursor = next;

    if (this.splitScene) {
      this.setSplitHover(this.hitTest(this.splitScene, this.cursor));
    } else {
      this.sendMouseEvent('mousemove');
    }
    this.emit('cursormove', { player: TILT_PLAYER, ...this.cursor });
  }

  /**
   * Point mode, like a Wii remote: where the controller points is where the cursor goes.
   * Up/down from a tilt angle (PITCH_AXIS), left/right from the gyro rotation (z).
   */
  private pointTarget(state: PlayerState, dt: number): Point {
    const P = CFG.POINT;
    const { pitch, yaw } = this.pointAngles(state);

    // Jitter filter: quick small changes (< DEAD_ZONE) are ignored; bigger ones are followed.
    // When held still, it slowly settles on the real value, so no offset of DEAD_ZONE stays behind.
    const settle = 1 - Math.exp(-dt / JITTER_SETTLE_TIME);
    this.held.pitch = followBeyond(this.held.pitch, pitch, P.DEAD_ZONE);
    this.held.yaw = followBeyond(this.held.yaw, yaw, P.DEAD_ZONE);
    this.held.pitch += (pitch - this.held.pitch) * settle;
    this.held.yaw += (yaw - this.held.yaw) * settle;

    const target = {
      x: GAME_WIDTH / 2 + (this.held.yaw / P.YAW_RANGE) * (GAME_WIDTH / 2),
      y: GAME_HEIGHT / 2 - (this.held.pitch / P.PITCH_RANGE) * (GAME_HEIGHT / 2),
    };

    const follow = P.SMOOTHING > 0 ? 1 - Math.exp(-dt / P.SMOOTHING) : 1;
    return {
      x: this.cursor.x + (target.x - this.cursor.x) * follow,
      y: this.cursor.y + (target.y - this.cursor.y) * follow,
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

  /** Rate mode, like a joystick: the tilt sets the speed of the cursor. */
  private rateTarget(state: PlayerState, dt: number): Point {
    const R = CFG.RATE;
    // Sensor y = tilt left/right -> screen x; sensor x = tilt forward/back -> screen y.
    let tiltX = state.y - state.neutralY;
    let tiltY = state.x - state.neutralX;
    if (R.SWAP_AXES) [tiltX, tiltY] = [tiltY, tiltX];
    if (R.INVERT_X) tiltX = -tiltX;
    if (R.INVERT_Y) tiltY = -tiltY;

    const follow = R.SMOOTHING > 0 ? 1 - Math.exp(-dt / R.SMOOTHING) : 1;
    this.velocity.x += (speedFor(tiltX) - this.velocity.x) * follow;
    this.velocity.y += (speedFor(tiltY) - this.velocity.y) * follow;
    return { x: this.cursor.x + this.velocity.x * dt, y: this.cursor.y + this.velocity.y * dt };
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
    ui.setArrow(tip.x, tip.y, this.mode === 'tilt' && !this.splitScene && !sceneHasOwnCursor);

    // "Point at the star", in the middle of the game.
    const middle = this.toClient({ x: GAME_WIDTH / 2, y: GAME_HEIGHT / 2 });
    const height = canvas.getBoundingClientRect().height;
    ui.setStar(middle.x, middle.y, height, CFG.RECENTER.TEXT, this.recentering && this.mode === 'tilt');
  }

  /** Is this scene in split mode (player 1 on the controller, player 2 on the mouse)? */
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

    const lines = [
      `mode      ${this.mode}${this.preferMouse ? ' (mouse chosen with T)' : ''}${this.splitScene ? '   split: P1 controller, P2 mouse' : ''}`,
      `control   ${CFG.CONTROL_MODE}${this.recentering ? '   waiting: point at the star' : ''}`,
      `ports     ${this.controllers.size}   ${this.messagesPerSecond} msg/s`,
      `cursor    ${this.cursor.x.toFixed(0)}, ${this.cursor.y.toFixed(0)}` +
        (CFG.CONTROL_MODE === 'rate' ? `   speed ${this.velocity.x.toFixed(0)}, ${this.velocity.y.toFixed(0)}` : ''),
      `mouse     ${this.mouse.x.toFixed(0)}, ${this.mouse.y.toFixed(0)}`,
    ];

    const p1 = this.players.get(TILT_PLAYER);
    if (p1 && CFG.CONTROL_MODE === 'point') {
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
      lines.push(
        `P${s.player}        x ${s.x.toFixed(1)}  y ${s.y.toFixed(1)}  z ${s.z.toFixed(1)}  shake ${s.shake ? 1 : 0}  btn ${s.btn ? 1 : 0}`,
        `          center ${s.neutralX.toFixed(1)}, ${s.neutralY.toFixed(1)}, ${s.neutralZ.toFixed(1)}   ` +
          (age > CFG.TIMEOUT_MS ? 'no data' : `${age.toFixed(0)} ms ago`),
      );
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
