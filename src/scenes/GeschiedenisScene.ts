import { GameObjects, Input, Math as PMath, Scene, type Types } from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE, setupCamera } from '../config';
import { dropIn, hop, popIn, riseIn, setRestAngle, sinkOut, slideIn, slideOut, swing } from '../puppet';
import { inputManager } from '../input/InputManager';
import { PlayerPointers } from '../playerPointers';
import { loadSvgParts } from '../svgParts';
import { addStartButton, preloadStartButton } from '../ui';

/*
 * Minigame "geschiedenis".
 *
 * Flow:
 *  0. Title: "GESCHIEDENIS" with the letters falling in one by one. Goes on
 *     with a button press, or by itself after a few seconds.
 *  1. Intro: explanation sign and cards. A button press starts the game.
 *  2. Player 1 digs with the trowel until something comes up. Only one thing
 *     is in the sand at a time; the joke finds come in between the real ones.
 *     - Joke finds (sock, poop) hop and disappear.
 *     - A real find: player 1 presses the button to pick it up.
 *  3. Player 2 brushes the dust off, then presses the button to put it on its sign.
 *  4. When all four signs are filled, the book can be dug up. Cleaning it opens the book.
 *
 * Controls (for now): the tool follows the mouse; a mouse click is "the button".
 * Later the ESP32 controllers can call onPointerMove-like movement and pressButton().
 */

const PATH = 'assets/minigame-geschiedenis/';

// ---------------------------------------------------------------------------
// Tuning: change these to make the game easier/harder or to move things around
// ---------------------------------------------------------------------------

/** Area of the sandbox where finds can be buried (game coordinates). */
const DIG_AREA = { x: 280, y: 520, width: 1360, height: 620 };
/** A new find is never buried closer than this to where the trowel is. */
const MIN_DISTANCE_FROM_TROWEL = 350;
/** How close (px) the trowel has to be to a find to dig it up. */
const DIG_RADIUS = 180;
/** How far (px) the trowel has to move near a find before it is dug up. */
const DIG_EFFORT = 1400;
/** Same for the joke finds (sock, poop): much less, about three strokes, so they don't take much energy. */
const FAKE_DIG_EFFORT = 600;
/** Size of a find while it is in the sand. */
const BURIED_SIZE = 260;
/** Size of a find while it is being cleaned. */
const CLEAN_SIZE = 780;
/** Number of dust spots on a find. */
const DUST_PER_FIND = 4;
/** Size of one dust spot (at cleaning size). */
const DUST_SIZE = 210;
/** Dust spots stay at least this far apart (center to center), so they don't clump together. */
const DUST_MIN_DISTANCE = 190;
/** How far (px) the brush has to move over a dust spot to remove it. */
const BRUSH_EFFORT = 700;

// Title screen.
const TITLE = { x: GAME_WIDTH / 2, y: 645, scale: 0.87 };
/** Time between two letters falling in. */
const TITLE_LETTER_DELAY = 70;
/** The title goes on by itself after this many ms (a button press goes on sooner). */
const TITLE_TIME = 4500;

/**
 * Where the brush and trowel are on the title screen and in the intro.
 * width = how wide they are on screen (game pixels), whatever the size of the image file.
 */
const TOOL_SPOTS = {
  title: { brush: { x: 581, y: 419, width: 194 }, trowel: { x: 1459, y: 830, width: 204 } },
  // Each tool next to its player's card: trowel (player 1) left, brush (player 2) right.
  intro: { brush: { x: 1245, y: 670, width: 256 }, trowel: { x: 640, y: 650, width: 243 } },
};

// Signs at the top of the screen (they hang from their post).
const SIGN_X = [395, 766, 1140, 1512];
const SIGN_TOP_Y = -45;
const SIGN_WIDTH = 318;
/** The dark inner board of a sign image, in pixels of the source image. */
// (Only the inner part: the wooden bars of the frame must stay visible.)
const SIGN_BOARD = { x: 142, y: 495, width: 830, height: 438 };
const SIGN_BOARD_COLOR = 0x743e21;

const SIGNS = [
  { key: 'gs-sign-trex', file: 'trex-sign.png' },
  { key: 'gs-sign-sarcofaag', file: 'sarcofaag sign.png' },
  { key: 'gs-sign-helmet', file: 'helmet sign.png' },
  { key: 'gs-sign-sword', file: 'sword sign.png' },
];

/** Explanation cards on a stick: x = center, scale = size on screen. */
const CARDS = {
  // Player 1 is on the left, player 2 on the right.
  // lean = how much the drawing itself already leans, in degrees (+ = to the right).
  // The intro cards stand a bit higher (bottomY), like in the design; they are drawn already leaning.
  introP1: { key: 'gs-card-p1-dig', file: 'speler1-stap1.svg', x: 395, scale: 0.885, lean: -5, bottomY: GAME_HEIGHT + 30 },
  introP2: { key: 'gs-card-p2-brush', file: 'speler2-stap1.svg', x: 1525, scale: 0.885, lean: 5, bottomY: GAME_HEIGHT + 30 },
  pickUp: { key: 'gs-card-p1-pickup', file: 'speler1-stap2.svg', x: 673, scale: 0.88, lean: -2.7, bottomY: undefined },
  place: { key: 'gs-card-p2-place', file: 'speler2-stap2.svg', x: 1624, scale: 0.88, lean: 5.4, bottomY: undefined },
};
/** The intro sign hangs from the top (its post goes up off the screen). */
const INTRO_SIGN = { key: 'gs-sign-archeoloog', file: 'sign-archeoloog.svg', x: GAME_WIDTH / 2, y: -20, scale: 0.87 };
/** "Druk op een knop om te starten", at the bottom between the cards. */
const START_BUTTON = { x: GAME_WIDTH / 2, y: 1140, width: 755 };
/** How far (degrees) the cards lean towards the outside of the screen. */
const CARD_LEAN = 5;
/** Cards and the intro sign stand with the end of their stick well below the screen. */
const CARD_BOTTOM_Y = GAME_HEIGHT + 110;
/**
 * When the player whose turn it is does nothing for this long (ms), their explanation card comes up
 * again (in case they forgot what to do). It goes away after HINT_CARD_TIME, or at their next press.
 */
const IDLE_HINT_TIME = 10_000;
const HINT_CARD_TIME = 4000;
/** Smaller pointer movements (game pixels per move) don't count as doing something (a controller always trembles a bit). */
const IDLE_MOVE_THRESHOLD = 4;
/** Where the hint card stands: player 1 on the left, player 2 on the right. */
const HINT_CARD_X = { p1: CARDS.introP1.x, p2: CARDS.introP2.x };

interface FindDef {
  key: string;
  file: string;
  /** real = goes on a sign, fake = joke find (no cleaning), book = final find */
  kind: 'real' | 'fake' | 'book';
  /** Index in SIGNS for real finds. */
  sign?: number;
  /**
   * Quote shown when the find is clean. x/y = center of the quote, relative to
   * the center of the find (game pixels); width = size on screen.
   */
  quote?: { file: string; x: number; y: number; width: number };
}

const FINDS: FindDef[] = [
  { key: 'gs-trex', file: 'trex skull.png', kind: 'real', sign: 0, quote: { file: 'quote-dino.svg', x: -346, y: -211, width: 664 } },
  { key: 'gs-sarcofaag', file: 'sarcofaag.png', kind: 'real', sign: 1, quote: { file: 'quote-sarcofaag.svg', x: -199, y: 412, width: 654 } },
  { key: 'gs-helmet', file: 'asterix hat.png', kind: 'real', sign: 2, quote: { file: 'quote-asterix.svg', x: -150, y: 425, width: 690 } },
  { key: 'gs-sword', file: 'sword.png', kind: 'real', sign: 3, quote: { file: 'quote-koningarthur.svg', x: -346, y: 346, width: 657 } },
  { key: 'gs-sock', file: 'sock.png', kind: 'fake' },
  { key: 'gs-poop', file: 'poop.png', kind: 'fake' },
];

const BOOK: FindDef = { key: 'gs-book', file: 'book.png', kind: 'book' };

/**
 * Sparkling stars on the spot where the book is buried (the last task).
 * count = how many, radius = how far from the spot, size = height of a star on screen.
 */
const SPARKLES = { count: 5, radius: 150, minSize: 100, maxSize: 160 };

/** "GEFOPT!" label next to a joke find: width on screen, and how long the joke find stays (ms). */
const GEFOPT = { width: 220, showTime: 1600 };

/** Draw order (higher = on top). */
const DEPTH = {
  sandbox: 1,
  buried: 2,
  signs: 3,
  backButton: 6,
  overlay: 10,
  active: 11,
  quote: 12,
  card: 15,
  tool: 20,
};

/** A find with its dust spots, grouped so they move and scale together. */
interface Find {
  def: FindDef;
  container: GameObjects.Container;
  item: GameObjects.Image;
  dust: { image: GameObjects.Image; dirt: number }[];
  effort: number;
}

interface Sign {
  container: GameObjects.Container;
  /** Board-colored patch that hides the silhouette. */
  cover: GameObjects.Rectangle;
  boardX: number;
  boardY: number;
  boardW: number;
  boardH: number;
  filled: boolean;
}

type State = 'title' | 'titleReady' | 'intro' | 'introReady' | 'busy' | 'dig' | 'pickUp' | 'clean' | 'place' | 'done';

/** Scale that makes an image fit inside maxWidth x maxHeight. */
function fitScale(image: GameObjects.Image, maxWidth: number, maxHeight: number): number {
  return Math.min(maxWidth / image.width, maxHeight / image.height);
}

export class GeschiedenisScene extends Scene {
  private state: State = 'intro';
  /** Finds still to come, in order. */
  private queue: FindDef[] = [];
  /** The one find that is in the sand right now. */
  private buried?: Find;
  private active?: Find;
  /** The quote of the find that was just cleaned. */
  private quote?: GameObjects.Image;
  /** Stars sparkling where the book is buried. */
  private sparkles: GameObjects.Image[] = [];
  private signs: Sign[] = [];
  private lastPointer = new PMath.Vector2();
  /** The "pick up" and "place" cards show up by themselves only the first time. */
  private seenCard = { pickUp: false, place: false };
  /** Scene time of the last movement or click (for the idle hint). */
  private lastActivity = 0;

  private titleObjects: GameObjects.Image[] = [];
  private introObjects: GameObjects.Image[] = [];
  /** Brush and trowel shown on the title and intro screens. */
  private introBrush?: GameObjects.Image;
  private introTrowel?: GameObjects.Image;
  private introPress?: GameObjects.Image;
  /** The players' hands, on the title, intro and end screens (while playing, the tools are the cursor). */
  private pointers!: PlayerPointers;
  private card?: GameObjects.Image;
  private overlay!: GameObjects.Rectangle;
  private backButton?: GameObjects.Image;
  private trowel!: GameObjects.Container;
  private brush!: GameObjects.Container;

  constructor() {
    super('GeschiedenisScene');
  }

  preload() {
    const image = (key: string, file: string) => this.load.image(key, PATH + file);

    [...FINDS, BOOK].forEach((find) => image(find.key, find.file));
    SIGNS.forEach((sign) => image(sign.key, sign.file));
    image('gs-book-open', 'book-1.png');
    image('gs-trowel', 'trowel.png');
    image('gs-brush', 'brush.png');
    image('gs-player1', 'player1.png');
    image('gs-player2', 'player2.png');
    image('gs-back', 'back-button.png');
    image('gs-dust1', 'dust1.png');
    image('gs-dust2', 'dust2.png');
    image('gs-dust3', 'dust3.png');
    // Quotes (shown when a find is clean) and the "GEFOPT!" label.
    for (const find of FINDS) {
      if (find.quote) this.load.svg(quoteKey(find), PATH + find.quote.file, { scale: RENDER_SCALE });
    }
    this.load.svg('gs-gefopt', PATH + 'gefopt.svg', { scale: RENDER_SCALE });
    this.load.svg('gs-star', PATH + 'star.svg', { scale: RENDER_SCALE });
    // Loaded as text: it is split into one image per letter (see svgParts.ts).
    this.load.text('gs-title', PATH + 'geschiedenis.svg');
    PlayerPointers.preload(this);

    // SVGs are turned into an image when loading (max 4096 px for GPU support).
    this.load.svg('gs-background', PATH + 'background.svg', { width: 3840, height: 2560 });
    this.load.svg('gs-sandbox', PATH + 'sandbox.svg', { width: 3840, height: 2110 });
    this.load.svg(INTRO_SIGN.key, PATH + INTRO_SIGN.file, { scale: RENDER_SCALE });
    preloadStartButton(this);
    Object.values(CARDS).forEach((card) => this.load.svg(card.key, PATH + card.file, { scale: RENDER_SCALE }));
  }

  create() {
    setupCamera(this);
    // Fade in from black (the menu fades out to black).
    this.cameras.main.fadeIn(600, 0, 0, 0);
    // Input is switched off while leaving the scene; switch it back on.
    this.input.enabled = true;
    // (The controllers are calibrated on the explanation screen, see showIntro.)

    // Reset state: the same scene object is reused when the scene restarts.
    this.state = 'title';
    this.queue = this.makeQueue();
    this.buried = undefined;
    this.active = undefined;
    this.signs = [];
    this.seenCard = { pickUp: false, place: false };
    this.lastActivity = this.time.now;
    this.titleObjects = [];
    this.introObjects = [];
    this.introBrush = undefined;
    this.introTrowel = undefined;
    this.introPress = undefined;
    this.quote = undefined;
    this.sparkles = [];
    this.card = undefined;
    this.backButton = undefined;

    this.add.image(0, 0, 'gs-background').setOrigin(0).setDisplaySize(GAME_WIDTH, GAME_HEIGHT);

    this.overlay = this.add
      .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000)
      .setOrigin(0)
      .setDepth(DEPTH.overlay)
      .setAlpha(0);

    // Tip = the point of the tool that digs/brushes (as a fraction of the image), then the width on screen.
    this.trowel = this.makeTool('gs-trowel', 0.12, 0.12, 274, 'gs-player1', 230, 50);
    this.brush = this.makeTool('gs-brush', 0.2, 0.85, 245, 'gs-player2', 170, -250);
    this.setTool('none');

    // Hands as the cursor until the game starts (then the trowel and brush take over).
    this.pointers = new PlayerPointers(this);
    this.pointers.show();
    // Title and explanation: both players' hands (player 1 controller, player 2 mouse).
    inputManager.setSplit(this);
    this.events.once('shutdown', () => inputManager.setPointerOwner(undefined));

    this.input.on('pointermove', this.onPointerMove, this);
    this.input.on('pointerup', this.pressButton, this);
    this.events.once('shutdown', () => {
      this.input.off('pointermove', this.onPointerMove, this);
      this.input.off('pointerup', this.pressButton, this);
      this.input.setDefaultCursor('default');
    });

    // The back button is there from the start (title and intro too).
    this.backButton = this.add
      .image(110, 84, 'gs-back')
      .setScale(95 / 335)
      .setDepth(DEPTH.backButton)
      // No system hand cursor: the players' own hands are shown instead.
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

    this.showTitle();
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  private onPointerMove(pointer: Input.Pointer) {
    const { x, y } = this.cameras.main.getWorldPoint(pointer.x, pointer.y);

    // Cap the distance so jumping the pointer around doesn't count as digging.
    const moved = Math.min(PMath.Distance.Between(this.lastPointer.x, this.lastPointer.y, x, y), 100);
    this.lastPointer.set(x, y);
    if (moved >= IDLE_MOVE_THRESHOLD) this.lastActivity = this.time.now;

    this.trowel.setPosition(x, y);
    this.brush.setPosition(x, y);

    // Near the right edge the player label moves to the left of the tool, so it stays visible.
    const flip = x > GAME_WIDTH - 420;
    for (const tool of [this.trowel, this.brush]) {
      const label = tool.getAt(1) as GameObjects.Image;
      label.setOrigin(flip ? 1 : 0, 0.5).setX(flip ? -40 : (label.getData('x') as number));
    }

    if (this.state === 'dig') this.dig(x, y, moved);
    else if (this.state === 'clean') this.brushAt(x, y, moved);
  }

  /** "The button" (mouse click for now, ESP32 button later). */
  private pressButton() {
    this.lastActivity = this.time.now;
    // Any button press puts away an explanation card that is still up.
    this.hideCard();

    if (this.state === 'titleReady') this.leaveTitle();
    else if (this.state === 'introReady') this.startGame();
    else if (this.state === 'pickUp') this.pickUp();
    else if (this.state === 'place') this.placeOnSign();
  }

  // ---------------------------------------------------------------------------
  // Title
  // ---------------------------------------------------------------------------

  private async showTitle() {
    const title = await loadSvgParts(this, this.cache.text.get('gs-title'), 'gs-title', RENDER_SCALE);
    // The player may have left the scene while the letters were being prepared.
    if (!this.sys.isActive() || this.state !== 'title') return;

    // Letters fall in one by one, like puppets on a string.
    const letters = title.parts.map((part, i) => {
      const letter = this.add
        .image(
          TITLE.x + (part.x - title.width / 2) * TITLE.scale,
          TITLE.y + (part.y - title.height / 2) * TITLE.scale,
          part.key,
        )
        .setScale(TITLE.scale / RENDER_SCALE)
        .setDepth(DEPTH.card);
      dropIn(this, letter, { delay: 200 + i * TITLE_LETTER_DELAY, distance: 900 });
      return letter;
    });

    // Then the tools come in and show what they do. They stay for the intro.
    const toolsDelay = 400 + letters.length * TITLE_LETTER_DELAY;
    const { brush: b, trowel: t } = TOOL_SPOTS.title;
    this.introBrush = this.add.image(b.x, b.y, 'gs-brush').setDepth(DEPTH.card);
    this.introBrush.setScale(b.width / this.introBrush.width);
    this.introTrowel = this.add.image(t.x, t.y, 'gs-trowel').setDepth(DEPTH.card);
    this.introTrowel.setScale(t.width / this.introTrowel.width);
    const brush = this.introBrush;
    const trowel = this.introTrowel;
    slideIn(this, brush, 'left', { delay: toolsDelay, sway: false, onComplete: () => this.brushing(brush) });
    slideIn(this, trowel, 'right', { delay: toolsDelay + 150, sway: false, onComplete: () => this.scooping(trowel) });

    this.titleObjects = letters;
    this.time.delayedCall(toolsDelay + 600, () => {
      if (this.state === 'title') this.state = 'titleReady';
    });
    this.time.delayedCall(TITLE_TIME, () => {
      if (this.state === 'titleReady') this.leaveTitle();
    });
  }

  private leaveTitle() {
    this.state = 'busy';

    const letters = this.titleObjects;
    letters.forEach((letter, i) => sinkOut(this, letter, { delay: i * 30 }));

    // The tools don't leave: they move on to their place in the intro.
    this.moveTool(this.introBrush, TOOL_SPOTS.intro.brush, (brush) => this.brushing(brush));
    this.moveTool(this.introTrowel, TOOL_SPOTS.intro.trowel, (trowel) => this.scooping(trowel));

    this.time.delayedCall(900, () => {
      letters.forEach((o) => o.destroy());
      this.showIntro();
    });
  }

  /** Glide a tool to a new spot, then start its movement again. */
  private moveTool(
    tool: GameObjects.Image | undefined,
    spot: { x: number; y: number; width: number },
    then: (tool: GameObjects.Image) => void,
  ) {
    if (!tool) return;
    this.tweens.killTweensOf(tool);
    this.tweens.add({
      targets: tool,
      x: spot.x,
      y: spot.y,
      scale: spot.width / tool.width,
      angle: 0,
      duration: 900,
      ease: 'Back.InOut',
      onComplete: () => then(tool),
    });
  }

  /** Brushing back and forth. */
  private brushing(brush: GameObjects.Image) {
    this.tweens.add({ targets: brush, x: brush.x + 50, angle: 8, duration: 350, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
  }

  /** Scooping. */
  private scooping(trowel: GameObjects.Image) {
    this.tweens.add({
      targets: trowel,
      y: trowel.y - 25,
      angle: -25,
      duration: 450,
      yoyo: true,
      repeat: -1,
      repeatDelay: 200,
      ease: 'Sine.InOut',
    });
  }

  // ---------------------------------------------------------------------------
  // Intro
  // ---------------------------------------------------------------------------

  private showIntro() {
    this.state = 'intro';

    // The sign comes down from the top and hangs still.
    const sign = this.add
      .image(INTRO_SIGN.x, INTRO_SIGN.y, INTRO_SIGN.key)
      .setOrigin(0.5, 0)
      .setScale(INTRO_SIGN.scale / RENDER_SCALE)
      .setDepth(DEPTH.card);
    dropIn(this, sign, { delay: 100, sway: false });

    // The brush and trowel are already here: they came along from the title.
    const brush = this.introBrush ?? this.add.image(0, 0, 'gs-brush');
    const trowel = this.introTrowel ?? this.add.image(0, 0, 'gs-trowel');
    // In front of the cards.
    brush.setDepth(DEPTH.card + 1);
    trowel.setDepth(DEPTH.card + 1);
    // They fade away while the players calibrate (so they look at the circle), and come back with the cards.
    this.tweens.add({ targets: [brush, trowel], alpha: 0, duration: 300 });

    // First the players calibrate their controllers ("point at the circle"); then the cards
    // come up and the game can be started. Without controllers that need it: right away.
    inputManager.calibrateThen(this, () => {
      if (!this.sys.isActive() || this.state !== 'intro') return;
      this.tweens.add({ targets: [brush, trowel], alpha: 1, duration: 400, delay: 300 });
      const cardP2 = this.addCard(CARDS.introP2);
      const cardP1 = this.addCard(CARDS.introP1);
      riseIn(this, cardP2, { delay: 400, gentle: true });
      riseIn(this, cardP1, { delay: 550, gentle: true });

      // "Druk op een knop om te starten" at the bottom.
      this.introPress = addStartButton(this, START_BUTTON.x, START_BUTTON.y, { width: START_BUTTON.width, depth: DEPTH.card, delay: 900 });

      this.introObjects = [sign, cardP2, cardP1, brush, trowel];
      this.time.delayedCall(1400, () => {
        if (this.state === 'intro') this.state = 'introReady';
      });
    });
  }

  private startGame() {
    this.state = 'busy';
    // The game itself: back to one pointer (the trowel and brush follow it).
    inputManager.setSplit(null);

    const [sign, cardP2, cardP1, brush, trowel] = this.introObjects;
    const press = this.introPress;
    this.introPress = undefined;
    if (press) {
      this.tweens.killTweensOf(press);
      this.tweens.add({ targets: press, alpha: 0, duration: 250, onComplete: () => press.destroy() });
    }
    sinkOut(this, cardP1);
    sinkOut(this, cardP2, { delay: 80 });
    sinkOut(this, sign, { delay: 160 });
    slideOut(this, brush, 'left');
    slideOut(this, trowel, 'right');
    this.time.delayedCall(800, () => this.introObjects.forEach((o) => o.destroy()));

    this.time.delayedCall(500, () => this.buildPlayfield());
  }

  // ---------------------------------------------------------------------------
  // Playfield
  // ---------------------------------------------------------------------------

  private buildPlayfield() {
    const sandbox = this.add
      .image(GAME_WIDTH / 2, 300, 'gs-sandbox')
      .setOrigin(0.5, 0)
      .setScale(2342 / 3840)
      .setDepth(DEPTH.sandbox);
    riseIn(this, sandbox, { distance: 1000, sway: false });

    SIGNS.forEach((def, i) => {
      // Origin at the top of the post, so the sign swings from where it hangs.
      const image = this.add.image(0, 0, def.key).setOrigin(0.5, 0);
      const s = SIGN_WIDTH / image.width;
      image.setScale(s);

      const boardX = (SIGN_BOARD.x + SIGN_BOARD.width / 2 - image.width / 2) * s;
      const boardY = (SIGN_BOARD.y + SIGN_BOARD.height / 2) * s;
      const boardW = SIGN_BOARD.width * s;
      const boardH = SIGN_BOARD.height * s;
      const cover = this.add.rectangle(boardX, boardY, boardW, boardH, SIGN_BOARD_COLOR).setAlpha(0);

      const container = this.add.container(SIGN_X[i], SIGN_TOP_Y, [image, cover]).setDepth(DEPTH.signs);
      dropIn(this, container, { delay: 300 + i * 120 });

      this.signs.push({ container, cover, boardX, boardY, boardW, boardH, filled: false });
    });

    this.buryNext();

    this.time.delayedCall(1100, () => {
      // The hand turns into the trowel: the game has started.
      this.pointers.hide();
      this.input.setDefaultCursor('none');
      this.setTool('trowel');
      this.state = 'dig';
      this.lastActivity = this.time.now;
    });
  }

  /** Every frame: bring the explanation back when the players seem stuck. */
  update() {
    // Whose turn is it? Player 1 digs and picks up, player 2 brushes and places.
    const player =
      this.state === 'dig' || this.state === 'pickUp'
        ? 'p1'
        : this.state === 'clean' || this.state === 'place'
          ? 'p2'
          : undefined;

    // Player 2's turn: player 2 moves the brush (the mouse, or player 2's controller).
    // Player 1's turn: player 1's controller, if connected.
    inputManager.setPointerOwner(player === 'p2' ? 2 : undefined);
    if (!player) return;

    const now = this.time.now;
    if (now - this.lastActivity < IDLE_HINT_TIME) return;
    this.lastActivity = now; // next hint after another IDLE_HINT_TIME of nothing
    if (!this.card) this.showHint(player);
  }

  /** A card on a stick that rises from below and sways. */
  private addCard(card: (typeof CARDS)[keyof typeof CARDS], x = card.x): GameObjects.Image {
    const image = this.add
      .image(x, card.bottomY ?? CARD_BOTTOM_Y, card.key)
      .setOrigin(0.5, 1)
      .setScale(card.scale / RENDER_SCALE)
      .setDepth(DEPTH.card);

    // Cards lean towards the outside of the screen: left cards to the left, right cards to the right.
    // `card.lean` is how much the drawing itself already leans (+ = to the right).
    const side = x < GAME_WIDTH / 2 ? -1 : 1;
    setRestAngle(image, side * CARD_LEAN - card.lean);
    return image;
  }

  private showCard(card: (typeof CARDS)[keyof typeof CARDS], x = card.x) {
    this.hideCard();
    this.card = this.addCard(card, x);
    riseIn(this, this.card, { gentle: true });
  }

  /** The explanation card for what that player has to do right now (when they seem to have forgotten). */
  private showHint(player: 'p1' | 'p2') {
    if (this.state === 'done') return;

    const card =
      player === 'p1'
        ? this.state === 'pickUp' ? CARDS.pickUp : CARDS.introP1
        : this.state === 'place' ? CARDS.place : CARDS.introP2;
    this.showCard(card, HINT_CARD_X[player]);

    const shown = this.card;
    this.time.delayedCall(HINT_CARD_TIME, () => {
      if (this.card === shown) this.hideCard();
    });
  }

  private hideCard() {
    const card = this.card;
    if (!card) return;
    this.card = undefined;
    sinkOut(this, card, { onComplete: () => card.destroy() });
  }

  /** A tool that follows the pointer, with a player label next to it. */
  private makeTool(
    key: string,
    tipX: number,
    tipY: number,
    width: number,
    labelKey: string,
    labelX: number,
    labelY: number,
  ): GameObjects.Container {
    const tool = this.add.image(0, 0, key).setOrigin(tipX, tipY);
    tool.setScale(width / tool.width);

    const label = this.add.image(labelX, labelY, labelKey).setOrigin(0, 0.5).setData('x', labelX);
    label.setScale(193 / label.width);

    return this.add.container(0, 0, [tool, label]).setDepth(DEPTH.tool);
  }

  private setTool(tool: 'trowel' | 'brush' | 'none') {
    this.trowel.setVisible(tool === 'trowel');
    this.brush.setVisible(tool === 'brush');
  }

  // ---------------------------------------------------------------------------
  // Digging (player 1)
  // ---------------------------------------------------------------------------

  /**
   * Order of the finds: the real ones shuffled, the joke finds in between
   * (never first or last), and the book at the end.
   */
  private makeQueue(): FindDef[] {
    const reals = PMath.RND.shuffle(FINDS.filter((f) => f.kind === 'real'));
    const fakes = PMath.RND.shuffle(FINDS.filter((f) => f.kind === 'fake'));

    // Gaps between real finds (1 = after the first one), from back to front
    // so inserting doesn't shift the gaps that are still to come.
    const gaps = PMath.RND.shuffle(Array.from({ length: reals.length - 1 }, (_, i) => i + 1))
      .slice(0, fakes.length)
      .sort((a, b) => b - a);
    const queue = [...reals];
    gaps.forEach((gap, i) => queue.splice(gap, 0, fakes[i]));

    return [...queue, BOOK];
  }

  /** Put the next find from the queue in the sand. */
  private buryNext() {
    const def = this.queue.shift();
    if (!def) return;

    const spot = this.randomSpot();
    // The item is sized for cleaning; the container shrinks it while it is in the sand.
    const item = this.add.image(0, 0, def.key);
    item.setScale(fitScale(item, CLEAN_SIZE, CLEAN_SIZE));
    const container = this.add
      .container(spot.x, spot.y, [item])
      .setScale(BURIED_SIZE / CLEAN_SIZE)
      .setAngle(PMath.Between(-15, 15))
      .setAlpha(0)
      .setDepth(DEPTH.buried);
    this.buried = { def, container, item, dust: [], effort: 0 };

    // Real finds (and the book) are dusty from the start, so the dust shows up
    // while digging. Joke finds get no dust: they don't need cleaning.
    if (def.kind !== 'fake') this.addDust(this.buried);

    // The book is the last task: stars sparkle on its spot, so the players know where to dig.
    if (def.kind === 'book') this.addSparkles(spot.x, spot.y);
  }

  /** Random spot in the dig area, not right under the trowel. */
  private randomSpot(): PMath.Vector2 {
    const spot = new PMath.Vector2();
    for (let attempt = 0; attempt < 100; attempt++) {
      spot.set(
        PMath.Between(DIG_AREA.x, DIG_AREA.x + DIG_AREA.width),
        PMath.Between(DIG_AREA.y, DIG_AREA.y + DIG_AREA.height),
      );
      if (PMath.Distance.BetweenPoints(spot, this.lastPointer) >= MIN_DISTANCE_FROM_TROWEL) break;
    }
    return spot;
  }

  private dig(x: number, y: number, moved: number) {
    const find = this.buried;
    if (!find) return;
    const { container } = find;
    if (PMath.Distance.Between(x, y, container.x, container.y) > DIG_RADIUS) return;

    find.effort += moved;
    const effort = find.def.kind === 'fake' ? FAKE_DIG_EFFORT : DIG_EFFORT;
    container.setAlpha(Math.min(find.effort / effort, 1));

    if (find.effort >= effort) {
      this.buried = undefined;
      this.unearth(find);
    }
  }

  private unearth(find: Find) {
    const { container } = find;
    if (find.def.kind === 'book') this.removeSparkles();

    // Joke find: hop, "GEFOPT!", wiggle and disappear. Then the next find goes in the sand.
    if (find.def.kind === 'fake') {
      const label = this.addGefopt(container);
      hop(this, container, () =>
        this.tweens.add({
          targets: container,
          alpha: 0,
          scale: container.scale * 0.5,
          delay: GEFOPT.showTime,
          duration: 300,
          onStart: () => this.tweens.add({ targets: label, alpha: 0, duration: 300 }),
          onComplete: () => {
            container.destroy();
            label.destroy();
            this.buryNext();
          },
        }),
      );
      return;
    }

    // Real find (or the book): it comes up dusty; player 1 has to pick it up.
    this.state = 'pickUp';
    this.active = find;
    hop(this, container);

    // Explain the first time only; after that the card comes back when they do nothing for a while (update).
    if (!this.seenCard.pickUp) {
      this.seenCard.pickUp = true;
      // Put the card on the other side of the screen so it doesn't cover the find.
      this.showCard(CARDS.pickUp, container.x > GAME_WIDTH / 2 ? CARDS.pickUp.x : GAME_WIDTH - CARDS.pickUp.x);
    }
  }

  private addDust(find: Find) {
    const w = find.item.displayWidth * 0.3;
    const h = find.item.displayHeight * 0.3;
    const placed: PMath.Vector2[] = [];

    for (let i = 0; i < DUST_PER_FIND; i++) {
      const spot = this.spreadOutSpot(w, h, placed);
      placed.push(spot);
      const image = this.add
        .image(spot.x, spot.y, `gs-dust${PMath.Between(1, 3)}`)
        .setAngle(PMath.Between(0, 359));
      image.setScale(DUST_SIZE / image.width);
      find.container.add(image);
      find.dust.push({ image, dirt: BRUSH_EFFORT });
    }
  }

  /**
   * A random spot within ±w, ±h that is at least DUST_MIN_DISTANCE from the
   * other dust spots. If there is no room for that (small find), it takes the
   * spot furthest away from the others.
   */
  private spreadOutSpot(w: number, h: number, others: PMath.Vector2[]): PMath.Vector2 {
    let best = new PMath.Vector2();
    let bestDistance = -1;
    for (let attempt = 0; attempt < 40; attempt++) {
      const spot = new PMath.Vector2(PMath.Between(-w, w), PMath.Between(-h, h));
      const nearest = others.reduce((min, o) => Math.min(min, spot.distance(o)), Infinity);
      if (nearest >= DUST_MIN_DISTANCE) return spot;
      if (nearest > bestDistance) {
        best = spot;
        bestDistance = nearest;
      }
    }
    return best;
  }

  private pickUp() {
    const find = this.active;
    if (!find) return;
    this.state = 'busy';
    this.hideCard();
    this.setTool('none');
    this.showOnlyTargetSilhouette(find);

    const { container } = find;
    container.setDepth(DEPTH.active);
    this.tweens.killTweensOf(container);
    this.tweens.add({ targets: this.overlay, alpha: 0.6, duration: 400 });
    this.tweens.add({
      targets: container,
      x: GAME_WIDTH / 2,
      y: GAME_HEIGHT / 2,
      angle: 0,
      scale: 1,
      duration: 700,
      ease: 'Back.Out',
      onComplete: () => {
        this.state = 'clean';
        this.setTool('brush');
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Cleaning (player 2)
  // ---------------------------------------------------------------------------

  private brushAt(x: number, y: number, moved: number) {
    const find = this.active;
    if (!find) return;
    const { container } = find;

    for (const spot of find.dust) {
      const spotX = container.x + spot.image.x * container.scale;
      const spotY = container.y + spot.image.y * container.scale;
      if (PMath.Distance.Between(x, y, spotX, spotY) > (DUST_SIZE / 2) * container.scale) continue;

      spot.dirt -= moved;
      spot.image.setAlpha(Math.max(spot.dirt / BRUSH_EFFORT, 0));
      if (spot.dirt <= 0) spot.image.destroy();
    }
    find.dust = find.dust.filter((spot) => spot.dirt > 0);

    if (find.dust.length === 0) this.finishCleaning(find);
  }

  private finishCleaning(find: Find) {
    this.state = 'busy';

    // Small "clean!" pop.
    this.tweens.add({
      targets: find.container,
      scale: 1.08,
      duration: 150,
      yoyo: true,
      completeDelay: 200,
      onComplete: () => {
        if (find.def.kind === 'book') {
          this.openBook(find);
        } else {
          this.showQuote(find);
          this.state = 'place';
          if (!this.seenCard.place) {
            this.seenCard.place = true;
            this.showCard(CARDS.place);
          }
        }
      },
    });
  }

  /** The quote of a clean find pops up next to it (e.g. "Rare jongens, die Kaboeko lezertjes..."). */
  private showQuote(find: Find) {
    const q = find.def.quote;
    if (!q) return;
    this.hideQuote();
    const quote = this.add
      .image(find.container.x + q.x, find.container.y + q.y, quoteKey(find.def))
      .setDepth(DEPTH.quote);
    quote.setScale(q.width / quote.width).setAngle(-2);
    popIn(this, quote);
    this.quote = quote;
  }

  private hideQuote() {
    const quote = this.quote;
    if (!quote) return;
    this.quote = undefined;
    this.tweens.killTweensOf(quote);
    this.tweens.add({ targets: quote, alpha: 0, scale: quote.scale * 0.8, duration: 250, onComplete: () => quote.destroy() });
  }

  /** A few stars twinkling around a spot, each on its own rhythm. */
  private addSparkles(x: number, y: number) {
    this.removeSparkles();
    const { count, radius, minSize, maxSize } = SPARKLES;
    for (let i = 0; i < count; i++) {
      // Spread around the spot, a bit randomly.
      const angle = (i / count) * Math.PI * 2 + PMath.FloatBetween(-0.4, 0.4);
      const distance = radius * PMath.FloatBetween(0.55, 1);
      const star = this.add
        .image(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance * 0.8, 'gs-star')
        .setDepth(DEPTH.buried + 1)
        .setAngle(PMath.Between(-20, 20))
        .setAlpha(0);
      const scale = PMath.Between(minSize, maxSize) / star.height;
      star.setScale(0);

      // Twinkle: grow and flash, shrink and fade, with a pause; each star out of step.
      this.tweens.add({
        targets: star,
        scale: { from: scale * 0.3, to: scale },
        alpha: { from: 0.2, to: 1 },
        angle: star.angle + PMath.Between(-25, 25),
        duration: PMath.Between(500, 800),
        delay: i * 180,
        yoyo: true,
        repeat: -1,
        repeatDelay: PMath.Between(150, 500),
        ease: 'Sine.InOut',
      });
      this.sparkles.push(star);
    }
  }

  private removeSparkles() {
    const stars = this.sparkles;
    this.sparkles = [];
    for (const star of stars) {
      this.tweens.killTweensOf(star);
      this.tweens.add({ targets: star, alpha: 0, scale: 0, duration: 250, onComplete: () => star.destroy() });
    }
  }

  /** "GEFOPT!" next to a joke find, on the side towards the middle of the screen. */
  private addGefopt(container: GameObjects.Container): GameObjects.Image {
    const side = container.x > GAME_WIDTH / 2 ? -1 : 1;
    const label = this.add
      .image(container.x + side * BURIED_SIZE * 0.35, container.y - BURIED_SIZE * 0.3, 'gs-gefopt')
      .setDepth(DEPTH.buried + 1)
      .setAngle(-side * 6);
    label.setScale(GEFOPT.width / label.width);
    popIn(this, label, { delay: 150 });
    return label;
  }

  // ---------------------------------------------------------------------------
  // Placing on the sign
  // ---------------------------------------------------------------------------

  /** While a find is out, only its own sign keeps its silhouette. */
  private showOnlyTargetSilhouette(find: Find) {
    this.signs.forEach((sign, i) => {
      if (sign.filled || i === find.def.sign) return;
      this.tweens.add({ targets: sign.cover, alpha: 1, duration: 300 });
    });
  }

  private showAllSilhouettes() {
    this.signs.forEach((sign) => {
      if (!sign.filled) this.tweens.add({ targets: sign.cover, alpha: 0, duration: 300 });
    });
  }

  private placeOnSign() {
    const find = this.active;
    if (!find || find.def.sign === undefined) return;
    this.active = undefined;
    this.state = 'busy';
    this.hideCard();
    this.hideQuote();
    this.setTool('none');

    const sign = this.signs[find.def.sign];
    const { container } = find;
    const scale = Math.min(
      (sign.boardW * 0.85) / find.item.displayWidth,
      (sign.boardH * 0.85) / find.item.displayHeight,
    );

    this.tweens.add({ targets: this.overlay, alpha: 0, duration: 600 });
    this.tweens.add({
      targets: container,
      x: sign.container.x + sign.boardX,
      y: sign.container.y + sign.boardY,
      scale,
      duration: 800,
      ease: 'Cubic.InOut',
      onComplete: () => {
        // Hang the find on the sign so it swings along, and give the sign a push.
        sign.filled = true;
        sign.cover.setAlpha(1);
        sign.container.add(container);
        container.setPosition(sign.boardX, sign.boardY);
        swing(this, sign.container);
        this.showAllSilhouettes();

        this.buryNext();
        this.state = 'dig';
        this.setTool('trowel');
      },
    });
  }

  // ---------------------------------------------------------------------------
  // End
  // ---------------------------------------------------------------------------

  /** End of the minigame (for now): the book opens. Content comes later. */
  private openBook(book: Find) {
    this.state = 'done';
    this.setTool('none');
    this.active = undefined;

    // No more explanation needed: an open card goes away.
    this.hideCard();

    this.tweens.add({ targets: book.container, alpha: 0, scale: 1.2, duration: 400 });
    this.tweens.add({ targets: this.overlay, alpha: 0.8, duration: 400 });

    const open = this.add
      .image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'gs-book-open')
      .setDepth(DEPTH.active + 1)
      .setAlpha(0);
    const scale = fitScale(open, GAME_WIDTH * 0.9, GAME_HEIGHT * 0.85);
    open.setScale(scale * 0.6);
    this.tweens.add({ targets: open, alpha: 1, scale, duration: 600, ease: 'Back.Out' });

    // The hands come back (to click the back button), and the back button goes on top.
    this.pointers.show();
    this.backButton?.setDepth(DEPTH.active + 2);
  }
}

function quoteKey(def: FindDef): string {
  return `${def.key}-quote`;
}
