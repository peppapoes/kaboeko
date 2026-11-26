import { GameObjects, Input, Math as PMath, Scene, type Types } from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE, setupCamera } from '../config';
import { inputManager } from '../input/InputManager';
import { PlayerPointers } from '../playerPointers';
import { popIn } from '../puppet';
import { Sea, SEA, waveY } from './adventureSea';

/*
 * Minigame "avontuur": sail to the treasure island together.
 *
 *  1. Sailing. Waves come towards the screen; new ones come up at the back,
 *     sometimes with a rock, the whale or the crocodile on them.
 *     - Player 1 (bucket): water splashes into the boat now and then. Hold the
 *       bucket on a puddle to fill it, move it over the railing and press the
 *       button (or shake) to throw the water overboard. More water = the boat
 *       sits lower.
 *     - Player 2 (red hand): grab the wheel and turn it to steer around the
 *       obstacles. Hold the mouse button and drag in a circle (or click once to
 *       grab and click again to let go).
 *     No game over: a hit shakes the boat and splashes extra water in.
 *  2. After VOYAGE_TIME the island comes closer. A press or click (either
 *     player) opens the treasure chest; the book comes out and opens.
 *
 * Players: player 1 = controller, player 2 = mouse (or player 2's controller).
 * Testing without a controller: player 1 on the keyboard (WASD/arrows to move,
 * Space/Enter is the button).
 *
 * The water is drawn in code: see adventureSea.ts.
 */

const PATH = 'assets/minigame-adventure/';

// ---------------------------------------------------------------------------
// Tuning: change these to make the game easier or harder
// ---------------------------------------------------------------------------

export const CONFIG = {
  /** How long (seconds) the players sail before the island shows up. */
  VOYAGE_TIME: 75,
  /** How fast the waves come closer (1 = from the horizon to off the screen in one second). */
  WAVE_SPEED: 0.09,

  OBSTACLES: {
    /** No obstacle during the first this many seconds. */
    firstAfter: 4,
    /** A new obstacle comes on every Nth new wave (random between these). */
    everyWaves: [3, 4] as [number, number],
    /** Chance that an obstacle is straight ahead (otherwise it is off to one side). */
    aheadChance: 0.75,
    /** Straight ahead: at most this far from the middle. Off to one side: between these. */
    aheadRange: 200,
    sideRange: [430, 700] as [number, number],
    /** Half the width of the boat for hits: smaller = easier. */
    boatHalfWidth: 140,
  },

  /** How fast the boat moves sideways with the wheel turned all the way (game pixels per second). */
  STEER_SPEED: 300,
  WHEEL: {
    /** The wheel can be turned this far (degrees) to each side... */
    maxAngle: 160,
    /** ...and steers at full strength from this angle on. */
    fullSteerAngle: 100,
    /** When let go, the wheel turns back this fast (degrees per second). */
    returnSpeed: 90,
    /** How close (px) to the middle of the wheel the hand has to be to grab it. */
    grabRadius: 310,
  },

  WATER: {
    /** First splash after this many seconds, then one every few seconds (random between these). */
    firstSplash: 3,
    splashEvery: [7, 11] as [number, number],
    /** This many buckets of water in the boat = as low as it sinks. */
    maxBuckets: 6,
    /** How far (px) a full boat sits lower. It never sinks further. */
    maxSink: 150,
    /** How long (ms) the bucket has to be on a puddle to fill. */
    fillTime: 500,
  },
};

// ---------------------------------------------------------------------------
// Layout. The assets are drawn for a 2160 x 1440 screen: DESIGN turns those
// sizes and positions into game coordinates.
// ---------------------------------------------------------------------------

const DESIGN = GAME_WIDTH / 2160;
const d = (value: number) => value * DESIGN;

/** The boat tilts around this point (bottom middle of the screen). */
const PIVOT = { x: GAME_WIDTH / 2, y: GAME_HEIGHT };
/** Top middle of boot.svg (the top of the mast), relative to the pivot. */
const BOAT = { x: d(1083) - PIVOT.x, y: d(545) - PIVOT.y, originX: 1475 / 2958 };
/** The middle of the wheel, relative to the pivot, and where that is inside stuur.svg. */
const WHEEL = { x: d(1078) - PIVOT.x, y: d(1118) - PIVOT.y, originX: 317 / 638, originY: 301 / 641 };

/** The clouds hang on their strings: x = the string, y = top of the image. */
const CLOUDS = [
  { key: 'av-cloud1', x: d(529), y: d(-1034), originX: 264 / 535 },
  { key: 'av-cloud2', x: d(1724), y: d(-1070), originX: 240 / 447 },
];

/** Top of the railing (game coordinates, boat not sunk). Water thrown from above it goes overboard. */
const RAIL = [
  [0, 975], [267, 908], [756, 813], [960, 787], [1156, 809], [1644, 903], [1920, 975],
] as const;

/** Where puddles can be on the deck (game coordinates, boat not sunk). */
const PUDDLE_SPOTS = [
  { x: 480, y: 1170 }, { x: 650, y: 1095 }, { x: 270, y: 1215 },
  { x: 1450, y: 1170 }, { x: 1280, y: 1095 }, { x: 1660, y: 1215 },
];
/** How close the bucket has to be to a puddle (an oval: wider than high). */
const PUDDLE_REACH = { x: 200, y: 170 };

/** Where player 2's hand and the bucket start. */
const HAND_START = { x: d(1210), y: d(986) };
const BUCKET_START = { x: d(565), y: d(1150) };
/** The player labels next to the bucket and the hand. */
const LABEL_OFFSET = { bucket: { x: d(200), y: d(-182) }, hand: { x: d(207), y: d(-120) } };
const LABEL_WIDTH = 190;

interface ObstacleDef {
  key: string;
  file: string;
  /** Where the bottom middle of the drawing is in the image (fractions). */
  originX: number;
  originY: number;
  /** Half the width for hits (game pixels, at full size). */
  halfWidth: number;
  /** How deep it sits in its wave (game pixels, at full size). */
  sunk: number;
  /** Animals bob up and down. */
  bob: number;
}

const OBSTACLES: ObstacleDef[] = [
  { key: 'av-rock1', file: 'background/steen01.svg', originX: 294 / 599, originY: 790 / 801, halfWidth: 170, sunk: 90, bob: 0 },
  { key: 'av-rock2', file: 'background/steen02.svg', originX: 262 / 535, originY: 1011 / 1022, halfWidth: 140, sunk: 90, bob: 0 },
  { key: 'av-rock3', file: 'background/steen03.svg', originX: 207 / 424, originY: 1045 / 1056, halfWidth: 120, sunk: 90, bob: 0 },
  { key: 'av-whale', file: 'obstakels/walvis.svg', originX: 335 / 679, originY: 549 / 676, halfWidth: 190, sunk: 40, bob: 22 },
  { key: 'av-croc', file: 'obstakels/tik-tok-krokodil.svg', originX: 252 / 512, originY: 616 / 641, halfWidth: 160, sunk: 50, bob: 22 },
];

/**
 * Obstacles ride on a wave. p = how close the wave is (0 = horizon).
 * At HIT_P it reaches the boat; between there and GONE_P it goes down and is gone.
 */
const HIT_P = 0.62;
const GONE_P = 0.84;

/** The island (with the chest on it): where its bottom middle ends up, and its size there. */
const ISLAND = { x: d(1080), bottom: d(1313), scale: 0.945 * DESIGN, startScale: 0.1 };
/** The chest and the book, as positions in the design (bottom middle of the chest, middle of the book). */
const CHEST = { x: d(1080), bottom: d(1017) };
const CHEST_BOOK = { x: d(1083), y: d(575) };
/** How far down the boat goes when we arrive at the island. */
const ARRIVE_BOAT_DROP = d(520);
/** How long (seconds) the island takes to come closer. */
const ARRIVE_TIME = 7;
/** The open book at the end (same as in the other games). */
const BOOK = { y: 650, closedWidth: 600, openWidth: 1520 };

/** Draw order (higher = on top). The waves and obstacles are between SEA.depth and SEA.depth + 1. */
const DEPTH = {
  clouds: 1,
  boat: 20,
  splash: 22,
  overlay: 30,
  book: 31,
  tools: 40,
  backButton: 50,
};

/** The images that are bigger than the GPU allows at RENDER_SCALE are loaded a bit smaller. */
const LOAD_SCALE: Record<string, number> = { 'av-boat': 1.38, 'av-island': 1.59 };
const loadScale = (key: string) => LOAD_SCALE[key] ?? RENDER_SCALE;

type State = 'sailing' | 'arriving' | 'chest' | 'opening' | 'done';

interface Obstacle {
  def: ObstacleDef;
  image: GameObjects.Image;
  /** The wave it rides on. */
  wave: number;
  /** Sideways position in the world (the boat is at boatX). */
  x: number;
  p: number;
  /** Has it reached the boat? (Then it can't hit any more.) */
  passed: boolean;
}

interface Puddle {
  spot: number;
  image: GameObjects.Image;
  /** How many buckets of water are in it (1 or 2). */
  buckets: number;
}

/** Height of the top of the railing at x. */
function railY(x: number): number {
  for (let i = 1; i < RAIL.length; i++) {
    const [x1, y1] = RAIL[i];
    const [x0, y0] = RAIL[i - 1];
    if (x <= x1) return PMath.Linear(y0, y1, PMath.Clamp((x - x0) / (x1 - x0), 0, 1));
  }
  return RAIL[RAIL.length - 1][1];
}

export class AdventureScene extends Scene {
  private state: State = 'sailing';
  private sea!: Sea;
  private boat!: GameObjects.Container;
  private wheel!: GameObjects.Image;
  private clouds: GameObjects.Image[] = [];
  private pointers!: PlayerPointers;
  private backButton!: GameObjects.Image;

  /** Seconds since the start. */
  private time0 = 0;
  /** Sideways position of the boat in the world. */
  private boatX = 0;
  private waveSpeed = CONFIG.WAVE_SPEED;
  /** How far the boat sits lower because of the water (smoothed). */
  private sink = 0;
  /** Extra downwards movement of the boat: when arriving at the island. */
  private boatDrop = 0;
  /** Shakes the boat after a hit (1 = just hit, fades out). */
  private jolt = 0;

  // Obstacles
  private obstacles: Obstacle[] = [];
  private wavesUntilObstacle = 0;
  /** Shuffled obstacles still to come, so every kind shows up. */
  private obstacleBag: ObstacleDef[] = [];

  // Water
  private puddles: Puddle[] = [];
  private splashTimer = 0;

  // Player 1: the bucket
  private bucket!: GameObjects.Container;
  private bucketImage!: GameObjects.Image;
  private bucketFull = false;
  /** How long (ms) the bucket has been on a puddle. */
  private filling = 0;
  /** The bucket wiggles until this time (when the button is pressed in the wrong place). */
  private bucketShakeUntil = 0;
  private keyboardPos = { ...BUCKET_START };
  private heldKeys = new Set<string>();

  // Player 2: the hand on the wheel
  private hand!: GameObjects.Container;
  private handImage!: GameObjects.Image;
  private handMoved = false;
  /** How far the wheel is turned (degrees, + = to the right). */
  private wheelAngle = 0;
  private grab?: { angle: number; sticky: boolean; startTime: number; startX: number; startY: number };

  // Ending
  private island?: GameObjects.Container;
  private chest?: GameObjects.Image;
  private arriveTime = 0;

  constructor() {
    super('AdventureScene');
  }

  preload() {
    const svg = (key: string, file: string) => this.load.svg(key, PATH + file, { scale: loadScale(key) });
    svg('av-boat', 'background/boot.svg');
    svg('av-island', 'background/eiland.svg');
    svg('av-cloud1', 'background/wolk01.svg');
    svg('av-cloud2', 'background/wolk02.svg');
    svg('av-chest-closed', 'background/schatkist-dicht.svg');
    svg('av-chest-open', 'background/schatkist-open.svg');
    svg('av-book', 'background/avontuur-boek.svg');
    svg('av-wheel', 'controllers/stuur.svg');
    svg('av-hand', 'controllers/hand.svg');
    svg('av-bucket', 'controllers/emmer.svg');
    svg('av-splash1', 'controllers/water-splash01.svg');
    svg('av-splash2', 'controllers/water-splash02.svg');
    OBSTACLES.forEach((o) => svg(o.key, o.file));
    // Also as text: recoloured into the full bucket (see makeFullBucket).
    this.load.text('av-bucket-svg', PATH + 'controllers/emmer.svg');

    // Shared with the geschiedenis game.
    this.load.image('av-back', 'assets/minigame-geschiedenis/back-button.png');
    this.load.image('av-label-p1', 'assets/minigame-geschiedenis/player1.png');
    this.load.image('av-label-p2', 'assets/minigame-geschiedenis/player2.png');
    this.load.image('av-book-open', 'assets/minigame-geschiedenis/book-1.png');
    PlayerPointers.preload(this);
  }

  create() {
    setupCamera(this);
    // Fade in from black (the menu fades out to black).
    this.cameras.main.fadeIn(600, 0, 0, 0);
    // Input is switched off while leaving the scene; switch it back on.
    this.input.enabled = true;
    // Controller in 'point' mode: "point at the star" first, to set the center.
    inputManager.startRecenter(this);

    // Reset state: the same scene object is reused when the scene restarts.
    this.state = 'sailing';
    this.time0 = 0;
    this.boatX = 0;
    this.waveSpeed = CONFIG.WAVE_SPEED;
    this.sink = 0;
    this.boatDrop = 0;
    this.jolt = 0;
    this.obstacles = [];
    this.wavesUntilObstacle = 1;
    this.obstacleBag = [];
    this.puddles = [];
    this.splashTimer = CONFIG.WATER.firstSplash;
    this.bucketFull = false;
    this.filling = 0;
    this.bucketShakeUntil = 0;
    this.keyboardPos = { ...BUCKET_START };
    this.heldKeys.clear();
    this.handMoved = false;
    this.wheelAngle = 0;
    this.grab = undefined;
    this.island = undefined;
    this.chest = undefined;
    this.arriveTime = 0;

    this.sea = new Sea(this);

    this.clouds = CLOUDS.map((cloud) =>
      this.add
        .image(cloud.x, cloud.y, cloud.key)
        .setOrigin(cloud.originX, 0)
        .setScale(DESIGN / loadScale(cloud.key))
        .setDepth(DEPTH.clouds),
    );

    this.buildBoat();
    this.buildTools();
    this.addBackButton();

    // Both players have their own pointer (player 1 controller, player 2 mouse).
    // During the game they are the bucket and the red hand; at the end, the normal hands.
    this.pointers = new PlayerPointers(this);
    inputManager.setSplit(this);
    this.input.setDefaultCursor('none');

    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('pointerup', this.onPointerUp, this);
    this.input.on('pointerupoutside', this.onPointerUp, this);
    this.input.on('pointermove', this.onPointerMove, this);
    inputManager.on('select', this.onSelect, this);
    inputManager.on('shake', this.onShake, this);
    window.addEventListener('keydown', this.onTestKey, true);
    window.addEventListener('keyup', this.onTestKey, true);
    this.events.once('shutdown', () => {
      this.input.off('pointerdown', this.onPointerDown, this);
      this.input.off('pointerup', this.onPointerUp, this);
      this.input.off('pointerupoutside', this.onPointerUp, this);
      this.input.off('pointermove', this.onPointerMove, this);
      inputManager.off('select', this.onSelect, this);
      inputManager.off('shake', this.onShake, this);
      window.removeEventListener('keydown', this.onTestKey, true);
      window.removeEventListener('keyup', this.onTestKey, true);
      this.input.setDefaultCursor('default');
    });
  }

  private buildBoat() {
    const hull = this.add.image(BOAT.x, BOAT.y, 'av-boat').setOrigin(BOAT.originX, 0).setScale(DESIGN / loadScale('av-boat'));
    this.wheel = this.add
      .image(WHEEL.x, WHEEL.y, 'av-wheel')
      .setOrigin(WHEEL.originX, WHEEL.originY)
      .setScale(DESIGN / RENDER_SCALE);
    // The puddles are added later, between the deck and the wheel.
    this.boat = this.add.container(PIVOT.x, PIVOT.y, [hull, this.wheel]).setDepth(DEPTH.boat);
  }

  private buildTools() {
    this.makeFullBucket();
    this.makePuddleTexture();

    const label = (key: string, offset: { x: number; y: number }) => {
      const image = this.add.image(offset.x, offset.y, key);
      return image.setScale(LABEL_WIDTH / image.width);
    };

    this.bucketImage = this.add.image(0, 0, 'av-bucket').setScale(DESIGN / RENDER_SCALE);
    this.bucket = this.add
      .container(BUCKET_START.x, BUCKET_START.y, [this.bucketImage, label('av-label-p1', LABEL_OFFSET.bucket)])
      .setDepth(DEPTH.tools);

    this.handImage = this.add.image(0, 0, 'av-hand').setScale(DESIGN / RENDER_SCALE);
    this.hand = this.add
      .container(HAND_START.x, HAND_START.y, [this.handImage, label('av-label-p2', LABEL_OFFSET.hand)])
      .setDepth(DEPTH.tools + 1);
  }

  private addBackButton() {
    this.backButton = this.add
      .image(110, 84, 'av-back')
      .setScale(95 / 335)
      .setDepth(DEPTH.backButton)
      .setInteractive()
      .on('pointerup', (_p: Input.Pointer, _x: number, _y: number, event: Types.Input.EventData) => {
        // Don't let this click also count as "the button".
        event.stopPropagation();
        // Fade to black, then back to the genre choice in the menu (without the title screen).
        this.input.enabled = false;
        this.cameras.main.fadeOut(400, 0, 0, 0);
        this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('MenuScene', { skipTitle: true }));
      });
    popIn(this, this.backButton, { delay: 300 });
  }

  // ---------------------------------------------------------------------------
  // Every frame
  // ---------------------------------------------------------------------------

  update(_time: number, delta: number) {
    // At most 50 ms per frame, so nothing jumps after a hiccup.
    const dt = Math.min(delta, 50) / 1000;
    this.time0 += dt;

    this.updateWheel(dt);
    this.updateSea(dt);
    this.updateObstacles();
    if (this.state === 'sailing') this.updateSplashes(dt);
    if (this.state === 'arriving') this.updateArrival(dt);
    this.updateBoat(dt);
    this.updateBucket(dt);
    this.updateHand();

    if (this.state === 'sailing' && this.time0 >= CONFIG.VOYAGE_TIME && this.obstacles.every((o) => o.passed)) {
      this.startArrival();
    }
  }

  private steer(): number {
    return PMath.Clamp(this.wheelAngle / CONFIG.WHEEL.fullSteerAngle, -1, 1);
  }

  private updateSea(dt: number) {
    if (this.state === 'sailing') this.boatX += this.steer() * CONFIG.STEER_SPEED * dt;

    // A wave that went off the screen comes up again at the back: maybe with something on it.
    for (const wave of this.sea.update(this.waveSpeed * dt, this.boatX)) this.onNewWave(wave);

    // The clouds sway on their strings, and swing a bit the other way when steering.
    this.clouds.forEach((cloud, i) => {
      const target = this.steer() * 2.2 + Math.sin(this.time0 * 0.5 + i * 2.5) * 0.9;
      cloud.angle += (target - cloud.angle) * Math.min(dt * 1.5, 1);
    });
  }

  private updateBoat(dt: number) {
    const water = this.waterAmount() / CONFIG.WATER.maxBuckets;
    const targetSink = Math.min(water, 1) * CONFIG.WATER.maxSink;
    this.sink += (targetSink - this.sink) * Math.min(dt * 2, 1);
    this.jolt = Math.max(this.jolt - dt * 1.4, 0);

    const bob = Math.sin(this.time0 * 1.7) * 7;
    const roll = Math.sin(this.time0 * 1.1) * 0.5 + this.steer() * 1.8 + Math.sin(this.time0 * 28) * this.jolt * 3;
    this.boat.y = PIVOT.y + this.sink + this.boatDrop + bob;
    this.boat.angle = roll;
  }

  /** How far the boat is moved down right now (puddles and the railing move with it). */
  private boatOffset(): number {
    return this.boat.y - PIVOT.y;
  }

  // ---------------------------------------------------------------------------
  // Obstacles
  // ---------------------------------------------------------------------------

  private onNewWave(wave: number) {
    if (this.state !== 'sailing') return;
    // Only things that can still reach the boat before the island shows up.
    if (this.time0 < CONFIG.OBSTACLES.firstAfter || this.time0 > CONFIG.VOYAGE_TIME - HIT_P / CONFIG.WAVE_SPEED) return;
    if (--this.wavesUntilObstacle > 0) return;
    const [min, max] = CONFIG.OBSTACLES.everyWaves;
    this.wavesUntilObstacle = PMath.Between(min, max);
    this.spawnObstacle(wave);
  }

  private spawnObstacle(wave: number) {
    if (this.obstacleBag.length === 0) this.obstacleBag = PMath.RND.shuffle([...OBSTACLES]);
    const def = this.obstacleBag.pop()!;
    const O = CONFIG.OBSTACLES;
    const offset =
      Math.random() < O.aheadChance
        ? PMath.Between(-O.aheadRange, O.aheadRange)
        : (Math.random() < 0.5 ? -1 : 1) * PMath.Between(...O.sideRange);
    const image = this.add.image(0, -2000, def.key).setOrigin(def.originX, def.originY);
    this.obstacles.push({ def, image, wave, x: this.boatX + offset, p: this.sea.progress(wave), passed: false });
  }

  private updateObstacles() {
    for (const obstacle of this.obstacles) {
      const { def, image } = obstacle;
      const p = this.sea.progress(obstacle.wave);
      // The wave started again at the back: this obstacle is long gone.
      const wrapped = p < obstacle.p;
      obstacle.p = wrapped ? GONE_P : p;

      if (!obstacle.passed && obstacle.p >= HIT_P) {
        obstacle.passed = true;
        const reach = def.halfWidth + CONFIG.OBSTACLES.boatHalfWidth;
        if (this.state === 'sailing' && Math.abs(obstacle.x - this.boatX) < reach) this.hit(obstacle);
      }

      // Further away = smaller, and closer to the middle (perspective).
      const near = obstacle.p / HIT_P;
      const size = 0.14 + 0.86 * Math.pow(near, 1.5);
      const spread = 0.25 + 0.75 * Math.pow(near, 1.3);
      // After the boat: it goes down into the water.
      const leaving = PMath.Clamp((obstacle.p - HIT_P) / (GONE_P - HIT_P), 0, 1);
      const bob = Math.sin(this.time0 * 3) * def.bob * size;
      image
        .setScale((size * DESIGN) / RENDER_SCALE)
        .setPosition(
          GAME_WIDTH / 2 + (obstacle.x - this.boatX) * spread,
          this.sea.waveTop(obstacle.wave) + (def.sunk * size + bob) + leaving * leaving * 700,
        )
        .setAlpha(1 - PMath.Clamp((leaving - 0.6) / 0.4, 0, 1))
        // Just behind its own wave, so that wave covers its bottom.
        .setDepth(SEA.depth + obstacle.p - 0.001);
    }

    this.obstacles = this.obstacles.filter((obstacle) => {
      if (obstacle.p < GONE_P) return true;
      obstacle.image.destroy();
      return false;
    });
  }

  /** The boat bumps into something: it shakes, and extra water splashes in. */
  private hit(obstacle: Obstacle) {
    this.jolt = 1;
    this.cameras.main.shake(450, 0.012);
    const x = PMath.Clamp(GAME_WIDTH / 2 + (obstacle.x - this.boatX), 350, GAME_WIDTH - 350);
    this.burst(x, railY(x) + 60 + this.boatOffset(), x < GAME_WIDTH / 2);
    this.splashIn(x < GAME_WIDTH / 2 ? 'left' : 'right');
  }

  /** A big burst of water against the boat (only to look at). */
  private burst(x: number, y: number, flip: boolean) {
    const splash = this.add
      .image(x, y, 'av-splash1')
      .setOrigin(0.5, 0.95)
      .setFlipX(flip)
      .setDepth(DEPTH.splash);
    const scale = (1.1 * DESIGN) / RENDER_SCALE;
    splash.setScale(scale * 0.2);
    this.tweens.add({ targets: splash, scale, duration: 260, ease: 'Back.Out' });
    this.tweens.add({ targets: splash, y: y + 180, alpha: 0, delay: 450, duration: 450, onComplete: () => splash.destroy() });
  }

  // ---------------------------------------------------------------------------
  // Water in the boat
  // ---------------------------------------------------------------------------

  /** Buckets of water in the boat (the water in the bucket is still in the boat). */
  private waterAmount(): number {
    return this.puddles.reduce((sum, puddle) => sum + puddle.buckets, 0) + (this.bucketFull ? 1 : 0);
  }

  private updateSplashes(dt: number) {
    this.splashTimer -= dt;
    if (this.splashTimer > 0) return;
    this.splashTimer = PMath.FloatBetween(...CONFIG.WATER.splashEvery);
    this.splashIn();
  }

  /** Water splashes over the railing and leaves a puddle on the deck. */
  private splashIn(side?: 'left' | 'right') {
    if (this.waterAmount() >= CONFIG.WATER.maxBuckets) return;

    const taken = new Set(this.puddles.map((p) => p.spot));
    let free = PUDDLE_SPOTS.map((_, i) => i).filter((i) => !taken.has(i));
    if (side) {
      const onSide = free.filter((i) => PUDDLE_SPOTS[i].x < GAME_WIDTH / 2 === (side === 'left'));
      if (onSide.length > 0) free = onSide;
    }
    if (free.length === 0) return;
    const spotIndex = PMath.RND.pick(free);
    const spot = PUDDLE_SPOTS[spotIndex];
    const buckets = Math.min(PMath.Between(1, 2), CONFIG.WATER.maxBuckets - this.waterAmount());

    // The puddle is taken right away (so no second splash picks this spot), and shows when the water lands.
    const image = this.add.image(spot.x - PIVOT.x, spot.y - PIVOT.y, 'av-puddle').setFlipX(Math.random() < 0.5).setVisible(false);
    this.boat.addAt(image, 1);
    const puddle: Puddle = { spot: spotIndex, image, buckets: 0 };
    this.puddles.push(puddle);

    // The splash comes over the railing, from the outside, and lands on the spot.
    const fromLeft = spot.x < GAME_WIDTH / 2;
    const startX = spot.x + (fromLeft ? -230 : 230);
    const splash = this.add
      .image(startX, railY(startX) + this.boatOffset() + 40, PMath.RND.pick(['av-splash1', 'av-splash2']))
      .setFlipX(fromLeft)
      .setDepth(DEPTH.splash)
      .setScale(0);
    const scale = (0.8 * DESIGN) / RENDER_SCALE;
    this.tweens.add({ targets: splash, scale, angle: fromLeft ? 15 : -15, duration: 350, ease: 'Back.Out' });
    this.tweens.add({ targets: splash, x: spot.x, y: spot.y + this.sink, angle: fromLeft ? 110 : -110, delay: 450, duration: 400, ease: 'Quad.In' });
    this.tweens.add({
      targets: splash,
      alpha: 0,
      scale: scale * 0.4,
      delay: 750,
      duration: 150,
      onComplete: () => {
        splash.destroy();
        if (!this.puddles.includes(puddle)) return;
        puddle.buckets = buckets;
        image.setVisible(true).setScale(0);
        this.tweens.add({ targets: image, scale: this.puddleScale(buckets), duration: 350, ease: 'Back.Out' });
      },
    });
  }

  private puddleScale(buckets: number): number {
    return (buckets > 1 ? 1 : 0.7) / RENDER_SCALE;
  }

  /** A puddle on the deck, with a few drops next to it. Drawn once. */
  private makePuddleTexture() {
    if (this.textures.exists('av-puddle')) return;
    const width = 340;
    const height = 150;
    const texture = this.textures.createCanvas('av-puddle', width * RENDER_SCALE, height * RENDER_SCALE);
    if (!texture) return;
    const ctx = texture.getContext();
    ctx.scale(RENDER_SCALE, RENDER_SCALE);
    ctx.fillStyle = SEA.dark;
    ctx.fill(
      new Path2D(
        'M45 40 C55 20 100 38 135 26 C170 5 285 15 300 55 C312 90 240 100 205 112 C170 128 150 132 100 120 C60 110 12 100 14 78 C16 62 40 60 45 40 Z',
      ),
    );
    ctx.fill(new Path2D('M225 128 C232 108 290 110 296 126 C300 142 235 148 225 128 Z'));
    ctx.beginPath();
    ctx.ellipse(70, 22, 24, 9, -0.1, 0, Math.PI * 2);
    ctx.fill();
    texture.refresh();
  }

  /** The bucket with water in it: emmer.svg with the dark inside coloured like water. */
  private makeFullBucket() {
    if (this.textures.exists('av-bucket-full')) return;
    const source = this.cache.text.get('av-bucket-svg') as string;
    const svg = source
      // The opening of the bucket is the dark path that starts here.
      .replace(/(<path d="M127\.377 106\.927[^>]*fill=")#03314E"/, `$1${SEA.light}"`)
      .replace('width="310" height="311"', `width="${310 * RENDER_SCALE}" height="${311 * RENDER_SCALE}"`);
    const image = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    image.onload = () => {
      if (!this.textures.exists('av-bucket-full')) this.textures.addImage('av-bucket-full', image);
      URL.revokeObjectURL(url);
    };
    image.src = url;
  }

  // ---------------------------------------------------------------------------
  // Player 1: the bucket
  // ---------------------------------------------------------------------------

  private bucketTarget(dt: number): { x: number; y: number } {
    if (inputManager.getMode() === 'tilt') return inputManager.getPlayerCursor(1);

    // No controller: the keyboard.
    const held = (...keys: string[]) => (keys.some((k) => this.heldKeys.has(k)) ? 1 : 0);
    const step = 900 * dt;
    this.keyboardPos.x = PMath.Clamp(this.keyboardPos.x + (held('d', 'arrowright') - held('a', 'arrowleft')) * step, 0, GAME_WIDTH);
    this.keyboardPos.y = PMath.Clamp(this.keyboardPos.y + (held('s', 'arrowdown') - held('w', 'arrowup')) * step, 0, GAME_HEIGHT);
    return this.keyboardPos;
  }

  /** Is the bucket above the railing, so the water goes into the sea? */
  private isOverboard(): boolean {
    return this.bucket.y < railY(this.bucket.x) + this.boatOffset() - 20;
  }

  private updateBucket(dt: number) {
    if (this.state === 'done') return;
    const { x, y } = this.bucketTarget(dt);
    this.bucket.setPosition(x, y);

    let angle = 0;
    if (this.state === 'sailing' && !this.bucketFull) {
      const puddle = this.puddles.find(
        (p) =>
          p.buckets > 0 &&
          ((x - PUDDLE_SPOTS[p.spot].x) / PUDDLE_REACH.x) ** 2 +
            ((y - PUDDLE_SPOTS[p.spot].y - this.boatOffset()) / PUDDLE_REACH.y) ** 2 <
            1,
      );
      if (puddle) {
        this.filling += dt * 1000;
        // Scooping.
        angle = Math.sin(this.time0 * 18) * 14;
        if (this.filling >= CONFIG.WATER.fillTime) this.fillBucket(puddle);
      } else {
        this.filling = 0;
      }
    } else if (this.state === 'sailing' && this.isOverboard()) {
      // Full and over the sea: the bucket starts to tip, "now press!".
      angle = (x < GAME_WIDTH / 2 ? -1 : 1) * (22 + Math.sin(this.time0 * 10) * 9);
    }
    if (this.time.now < this.bucketShakeUntil) angle = Math.sin(this.time0 * 45) * 15;
    this.bucketImage.angle = angle;
  }

  private fillBucket(puddle: Puddle) {
    this.filling = 0;
    this.bucketFull = true;
    if (this.textures.exists('av-bucket-full')) this.bucketImage.setTexture('av-bucket-full');
    popIn(this, this.bucketImage, { duration: 300 });

    puddle.buckets--;
    this.tweens.killTweensOf(puddle.image);
    if (puddle.buckets > 0) {
      this.tweens.add({ targets: puddle.image, scale: this.puddleScale(puddle.buckets), duration: 300 });
    } else {
      this.puddles = this.puddles.filter((p) => p !== puddle);
      this.tweens.add({ targets: puddle.image, scale: 0, duration: 300, onComplete: () => puddle.image.destroy() });
    }
  }

  private emptyBucket() {
    this.bucketFull = false;
    this.tweens.killTweensOf(this.bucketImage);
    this.bucketImage.setTexture('av-bucket').setScale(DESIGN / RENDER_SCALE);
  }

  /** Player 1's button (or a shake) while sailing: throw the water overboard. */
  private throwWater() {
    if (!this.bucketFull) return;
    if (!this.isOverboard()) {
      this.bucketShakeUntil = this.time.now + 350;
      return;
    }
    this.emptyBucket();

    // The water flies out, away from the boat.
    const side = this.bucket.x < GAME_WIDTH / 2 ? -1 : 1;
    const water = this.add
      .image(this.bucket.x + side * 40, this.bucket.y - 40, 'av-splash2')
      .setOrigin(0.35, 0.85)
      .setFlipX(side < 0)
      .setDepth(DEPTH.splash);
    const scale = (0.75 * DESIGN) / RENDER_SCALE;
    water.setScale(scale * 0.3);
    this.tweens.add({ targets: water, scale, duration: 250, ease: 'Back.Out' });
    this.tweens.add({ targets: water, x: water.x + side * 180, angle: side * 45, duration: 700, ease: 'Sine.Out' });
    this.tweens.add({ targets: water, y: water.y - 90, duration: 300, ease: 'Quad.Out' });
    this.tweens.add({ targets: water, y: water.y + 130, alpha: 0, delay: 300, duration: 400, ease: 'Quad.In', onComplete: () => water.destroy() });
  }

  // ---------------------------------------------------------------------------
  // Player 2: the hand and the wheel
  // ---------------------------------------------------------------------------

  private handPosition() {
    return this.handMoved ? inputManager.getPlayerCursor(2) : HAND_START;
  }

  private wheelCenter() {
    return { x: PIVOT.x + WHEEL.x, y: PIVOT.y + WHEEL.y + this.boatOffset() };
  }

  private onPointerMove(pointer: Input.Pointer) {
    // Pointer 99 is player 1's "click" (see InputManager.pressAt).
    if (pointer.id !== 99) this.handMoved = true;
  }

  private onPointerDown(pointer: Input.Pointer) {
    if (pointer.id === 99 || this.state !== 'sailing') return;
    this.handMoved = true;
    // Already holding it after a single click: this click lets go.
    if (this.grab?.sticky) {
      this.grab = undefined;
      return;
    }
    const { x, y } = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const center = this.wheelCenter();
    if (PMath.Distance.Between(x, y, center.x, center.y) > CONFIG.WHEEL.grabRadius) return;
    this.grab = {
      angle: Math.atan2(y - center.y, x - center.x),
      sticky: false,
      startTime: this.time.now,
      startX: x,
      startY: y,
    };
  }

  private onPointerUp(pointer: Input.Pointer) {
    const grab = this.grab;
    if (pointer.id === 99 || !grab || grab.sticky) return;
    const { x, y } = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    // A short click without moving keeps hold of the wheel (also for player 2's controller,
    // whose button can't be held down). Otherwise: let go.
    const click = this.time.now - grab.startTime < 300 && PMath.Distance.Between(x, y, grab.startX, grab.startY) < 25;
    if (click) grab.sticky = true;
    else this.grab = undefined;
  }

  private updateWheel(dt: number) {
    const W = CONFIG.WHEEL;
    const grab = this.grab;
    if (grab && this.state === 'sailing') {
      const hand = this.handPosition();
      const center = this.wheelCenter();
      const angle = Math.atan2(hand.y - center.y, hand.x - center.x);
      // Right at the middle the angle jumps around: don't turn then.
      if (PMath.Distance.Between(hand.x, hand.y, center.x, center.y) > 45) {
        const turned = PMath.RadToDeg(PMath.Angle.Wrap(angle - grab.angle));
        this.wheelAngle = PMath.Clamp(this.wheelAngle + turned, -W.maxAngle, W.maxAngle);
      }
      grab.angle = angle;
    } else {
      // Let go: the wheel turns back to straight ahead.
      const back = Math.min(Math.abs(this.wheelAngle), W.returnSpeed * dt);
      this.wheelAngle -= Math.sign(this.wheelAngle) * back;
    }
    this.wheel.angle = this.wheelAngle;
  }

  private updateHand() {
    if (this.state === 'done') return;
    const { x, y } = this.handPosition();
    this.hand.setPosition(x, y);
    // A bit smaller while holding the wheel, like a closing hand.
    this.handImage.setScale(((this.grab ? 0.86 : 1) * DESIGN) / RENDER_SCALE);
  }

  // ---------------------------------------------------------------------------
  // Buttons
  // ---------------------------------------------------------------------------

  /** A click or button press of either player. */
  private onSelect(event: { player?: number }) {
    if (this.state === 'chest') this.openChest();
    else if (this.state === 'sailing' && event.player === 1) this.throwWater();
  }

  private onShake(event: { player: number }) {
    if (this.state === 'chest') this.openChest();
    else if (this.state === 'sailing' && event.player === 1) this.throwWater();
  }

  /** Testing without a controller: player 1 on the keyboard (WASD/arrows + Space/Enter). */
  private onTestKey = (event: KeyboardEvent) => {
    if (inputManager.getMode() === 'tilt' || event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
      event.preventDefault();
      // So D doesn't also open the debug panel.
      event.stopImmediatePropagation();
      if (event.type === 'keydown') this.heldKeys.add(key);
      else this.heldKeys.delete(key);
    } else if ((key === ' ' || key === 'enter') && event.type === 'keydown') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) this.onSelect({ player: 1 });
    }
  };

  // ---------------------------------------------------------------------------
  // Arriving at the island
  // ---------------------------------------------------------------------------

  private startArrival() {
    this.state = 'arriving';
    this.arriveTime = 0;
    this.grab = undefined;

    // No more water: the bucket empties and the puddles dry up.
    this.emptyBucket();
    const puddles = this.puddles;
    this.puddles = [];
    puddles.forEach((puddle) => {
      this.tweens.killTweensOf(puddle.image);
      this.tweens.add({ targets: puddle.image, alpha: 0, duration: 800, onComplete: () => puddle.image.destroy() });
    });

    // The island with the chest on it comes closer, as one piece.
    const island = this.add.image(0, 0, 'av-island').setOrigin(0.5, 1343 / 1354).setScale(ISLAND.scale / loadScale('av-island'));
    this.chest = this.add
      .image(CHEST.x - ISLAND.x, CHEST.bottom - ISLAND.bottom, 'av-chest-closed')
      // The bottom middle of the chest (the same spot in the open and the closed image).
      .setOrigin(277 / 564, 314 / 325)
      .setScale(DESIGN / RENDER_SCALE);
    this.island = this.add.container(ISLAND.x, ISLAND.bottom, [island, this.chest]).setAlpha(0);
    this.tweens.add({ targets: this.island, alpha: 1, duration: 600 });
    this.updateArrival(0);
  }

  private updateArrival(dt: number) {
    const island = this.island;
    if (!island) return;
    this.arriveTime += dt;
    const t = Math.min(this.arriveTime / ARRIVE_TIME, 1);
    const eased = PMath.Easing.Sine.InOut(t);

    // From small at the horizon to its place.
    const bottom = PMath.Linear(waveY(0.1), ISLAND.bottom, eased);
    island.setScale(PMath.Linear(ISLAND.startScale, 1, eased)).setPosition(ISLAND.x, bottom);
    // The waves nearer than the island's shore are in front of it (they cover its bottom edge).
    island.setDepth(SEA.depth + PMath.Clamp((bottom - SEA.horizon) / (ISLAND.bottom - SEA.horizon), 0.05, 1) * 0.66);

    // The boat slows down; in the second half it sinks out of view, to show the island.
    this.waveSpeed = CONFIG.WAVE_SPEED * PMath.Linear(1, 0.12, eased);
    this.boatDrop = ARRIVE_BOAT_DROP * PMath.Easing.Sine.InOut(PMath.Clamp((t - 0.4) / 0.6, 0, 1));

    if (t >= 1) {
      this.state = 'chest';
      const chest = this.chest!;
      // "Open me!": the chest hops until someone presses.
      this.tweens.add({ targets: chest, angle: { from: -3, to: 3 }, duration: 110, yoyo: true, repeat: 3, loop: -1, loopDelay: 900 });
    }
  }

  // ---------------------------------------------------------------------------
  // The chest and the book
  // ---------------------------------------------------------------------------

  private openChest() {
    const chest = this.chest;
    const island = this.island;
    if (!chest || !island) return;
    this.state = 'opening';

    this.tweens.killTweensOf(chest);
    chest.setAngle(0).setTexture('av-chest-open').setOrigin(280 / 571, 487 / 498);
    const scale = chest.scale;
    this.tweens.add({ targets: chest, scaleX: scale * 1.08, scaleY: scale * 0.94, duration: 120, yoyo: true });

    // The book comes up out of the chest.
    const book = this.add.image(CHEST.x, CHEST.bottom - 150, 'av-book').setDepth(DEPTH.book);
    const bookScale = DESIGN / RENDER_SCALE;
    book.setScale(bookScale * 0.2);
    this.tweens.add({
      targets: book,
      x: CHEST_BOOK.x,
      y: CHEST_BOOK.y,
      scale: bookScale,
      angle: { from: -25, to: 0 },
      delay: 250,
      duration: 800,
      ease: 'Back.Out',
      completeDelay: 1400,
      onComplete: () => this.openBook(book),
    });
  }

  /** The book grows, then opens (squash shut, swap to the open book, unfold). */
  private openBook(book: GameObjects.Image) {
    // The bucket and the hand make room for the book.
    this.tweens.add({ targets: [this.bucket, this.hand], alpha: 0, duration: 300 });
    const overlay = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000).setOrigin(0).setDepth(DEPTH.overlay).setAlpha(0);
    this.tweens.add({ targets: overlay, alpha: 0.55, duration: 500 });

    this.tweens.add({
      targets: book,
      x: GAME_WIDTH / 2,
      y: BOOK.y,
      scale: BOOK.closedWidth / book.width,
      duration: 600,
      ease: 'Back.Out',
      completeDelay: 250,
      onComplete: () => {
        this.tweens.add({
          targets: book,
          scaleX: 0,
          duration: 180,
          ease: 'Quad.In',
          onComplete: () => {
            book.setTexture('av-book-open');
            const openScale = BOOK.openWidth / book.width;
            book.setScale(0, openScale);
            this.tweens.add({ targets: book, scaleX: openScale, duration: 500, ease: 'Back.Out', onComplete: () => this.finish() });
          },
        });
      },
    });
  }

  private finish() {
    this.state = 'done';
    // The normal hands come back (to click the back button).
    this.pointers.show();
    this.backButton.setDepth(DEPTH.backButton);
  }
}
