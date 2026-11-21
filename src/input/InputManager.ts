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
  /** Rotation; drifts over time, so not used. */
  z: number;
  shake: boolean;
  btn: boolean;
  /** Tilt that counts as "level" (set by calibration). */
  neutralX: number;
  neutralY: number;
  /** performance.now() of the last message. */
  lastSeen: number;
}

/** The controller player whose tilt moves the tilt cursor. */
const TILT_PLAYER = 1;
/** In split mode, the mouse belongs to this player. */
const MOUSE_PLAYER = 2;

const DEBUG_REFRESH_MS = 250;
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

  /** Make the current tilt of every connected controller the neutral position. */
  calibrate() {
    let count = 0;
    for (const state of this.players.values()) {
      if (!this.isFresh(state)) continue;
      state.neutralX = state.x;
      state.neutralY = state.y;
      count++;
    }
    this.velocity = { x: 0, y: 0 };
    this.ui?.flash(count > 0 ? 'calibrated' : 'no controller data');
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

    const { p, x, y, z } = message;
    if (typeof p !== 'number' || typeof x !== 'number' || typeof y !== 'number') return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    const now = performance.now();
    this.messageCount++;

    let state = this.players.get(p);
    // First data from this controller, or first after a gap: (re)calibrate.
    const freshStart = !state || now - state.lastSeen > CFG.TIMEOUT_MS;
    if (!state) {
      state = { player: p, x, y, z: 0, shake: false, btn: false, neutralX: x, neutralY: y, lastSeen: now };
      this.players.set(p, state);
    }
    if (freshStart) {
      state.neutralX = x;
      state.neutralY = y;
      if (p === TILT_PLAYER) this.preferMouse = false;
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
    state.z = typeof z === 'number' ? z : 0;
    state.shake = shake;
    state.btn = btn;
    state.lastSeen = now;

    if (p === TILT_PLAYER && this.mode === 'mouse' && !this.preferMouse) this.setMode('tilt');
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
    this.velocity = { x: 0, y: 0 };
    if (mode === 'mouse') this.setSplitHover(undefined);
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

  /** Joystick-style: the tilt sets the speed of the cursor. */
  private moveCursor(dt: number) {
    const state = this.players.get(TILT_PLAYER);
    if (!state || dt <= 0) return;

    // Sensor y = tilt left/right -> screen x; sensor x = tilt forward/back -> screen y.
    let tiltX = state.y - state.neutralY;
    let tiltY = state.x - state.neutralX;
    if (CFG.SWAP_AXES) [tiltX, tiltY] = [tiltY, tiltX];
    if (CFG.INVERT_X) tiltX = -tiltX;
    if (CFG.INVERT_Y) tiltY = -tiltY;

    const follow = CFG.SMOOTHING > 0 ? 1 - Math.exp(-dt / CFG.SMOOTHING) : 1;
    this.velocity.x += (speedFor(tiltX) - this.velocity.x) * follow;
    this.velocity.y += (speedFor(tiltY) - this.velocity.y) * follow;

    const next = this.clamp({ x: this.cursor.x + this.velocity.x * dt, y: this.cursor.y + this.velocity.y * dt });
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
      `ports     ${this.controllers.size}   ${this.messagesPerSecond} msg/s`,
      `tilt      ${this.cursor.x.toFixed(0)}, ${this.cursor.y.toFixed(0)}   speed ${this.velocity.x.toFixed(0)}, ${this.velocity.y.toFixed(0)}`,
      `mouse     ${this.mouse.x.toFixed(0)}, ${this.mouse.y.toFixed(0)}`,
    ];
    if (this.players.size === 0) lines.push('no controller data yet');
    for (const s of [...this.players.values()].sort((a, b) => a.player - b.player)) {
      const age = now - s.lastSeen;
      lines.push(
        `P${s.player}        x ${s.x.toFixed(1)}  y ${s.y.toFixed(1)}  shake ${s.shake ? 1 : 0}  btn ${s.btn ? 1 : 0}`,
        `          neutral ${s.neutralX.toFixed(1)}, ${s.neutralY.toFixed(1)}   ` +
          (age > CFG.TIMEOUT_MS ? 'no data' : `${age.toFixed(0)} ms ago`),
      );
    }
    lines.push('', 'T mouse/controller  C calibrate  Space P1 button  D close');
    this.ui.setDebugText(lines.join('\n'));
  }
}

/** Tilt (degrees) -> cursor speed (px/s), with a dead zone and a maximum. */
function speedFor(tilt: number): number {
  const size = Math.abs(tilt);
  if (size <= CFG.DEAD_ZONE) return 0;
  const amount = Math.min((size - CFG.DEAD_ZONE) / (CFG.MAX_ANGLE - CFG.DEAD_ZONE), 1);
  return Math.sign(tilt) * amount * CFG.MAX_SPEED;
}

function depthOf(object: GameObjects.GameObject): number {
  return (object as GameObjects.GameObject & { depth?: number }).depth ?? 0;
}

/** The one input manager for the whole game. */
export const inputManager = new InputManager();
