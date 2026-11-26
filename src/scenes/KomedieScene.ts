import { GameObjects, Input, Math as PMath, Scene, type Types } from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE, setupCamera } from '../config';
import { inputManager } from '../input/InputManager';
import { PlayerPointers } from '../playerPointers';
import { dropIn, popIn, riseIn, sinkOut, slideIn } from '../puppet';
import { loadSvgParts } from '../svgParts';
import { addStartButton, preloadStartButton } from '../ui';
import { COMEDY_CHARACTERS, type ComedyCharacter, type Movement } from './komedieCharacters';

/*
 * Minigame "komedie": "Wie zei dat?"
 *
 *  0. Title: "KOMEDIE" with the letters falling in one by one, then a blue
 *     and a red balloon come in.
 *  1. Intro: the letters go, the balloons move next to the cards, the sign
 *     comes down and the cards and "druk op een knop" come up.
 *     A button press (click, controller button, or a throw/shake) starts the game.
 *  2. Play: a quote hangs at the top. The characters move around the circus tent.
 *     Both players throw water balloons at the one who says the quote (they
 *     play together). A hit knocks the character over; then the next quote comes.
 *  3. Ending: "Iedereen ligt plat!", the cannon shoots a book, the book opens.
 *
 * Players: player 1 = controller (aim by tilting, throw with the button or a
 * shake), player 2 = mouse (aim with the mouse, throw with a click). Without a
 * controller, only the mouse plays (as player 2, red), like the other games.
 *
 * Characters and quotes: komedieCharacters.ts. Tuning: CONFIG below.
 */

const PATH = 'assets/minigame-komedie/';

// ---------------------------------------------------------------------------
// Tuning — everything that changes how the game feels
// ---------------------------------------------------------------------------

export const CONFIG = {
  /** How many characters (and quotes) in one round. */
  CHARACTERS_PER_ROUND: 4,
  /** After this many ms without a correct hit, the right character starts to wiggle and glow. */
  HINT_DELAY: 8000,
  /** A player can throw again after this many ms. */
  THROW_COOLDOWN: 400,
  /** How long a balloon flies (ms), and how high its arc goes (game pixels). */
  BALLOON_FLIGHT_TIME: 300,
  BALLOON_ARC_HEIGHT: 120,
  /** Balloon size at the end of its flight (it starts at the size of the waiting balloon, and shrinks: further away). */
  BALLOON_END_WIDTH: 70,
  /** Extra room around each character that still counts as a hit (game pixels). */
  HITBOX_PADDING: 30,
  /**
   * Both players must hit the right character, not at the same moment but within this many ms of each other.
   * (Only while two players play: with just the mouse, one hit is enough.)
   */
  TEAM_HIT_WINDOW: 3000,
  /** After the right hit: first the balloon bursts on the character (it stands still) for this many ms, then the spotlight. */
  SPLASH_BEFORE_SPOTLIGHT: 700,
  /** How long the spotlight on the right character lasts (ms), then the pause before the next quote. */
  REVEAL_TIME: 2400,
  NEXT_QUOTE_DELAY: 1000,
  /** How long "FOUT!" shows next to a wrong character (ms). */
  WRONG_TIME: 1000,
  SPEED: {
    /** Walking, in game pixels per second. */
    walk: 160,
    /** Peeking out of the podium (bounce): seconds hidden (random between these), seconds to come out or go back, seconds out. */
    peekHidden: [1.2, 3] as [number, number],
    peekMove: 0.35,
    peekHold: 1.8,
    /** While the hint is on, the character hides for at most this many seconds. */
    peekHiddenHint: 0.5,
    /** Balancing on the ball: how fast the ball rolls, in game pixels per second. */
    ball: 120,
    /** Shot from the cannon: seconds from the cannon to off the screen, then seconds until the next shot. */
    cannonFlightTime: 3.2,
    cannonPause: 1.2,
    /** Flying: seconds for one whole figure-eight. */
    flyLoopTime: 11,
    /** Trapeze: seconds for one swing back and forth, and how far (degrees; about 36 or more swings out of the screen). */
    swingTime: 10,
    swingAngle: 42,
    /** walkFall and ball: seconds between two falls (random between these). */
    fallEvery: [4, 7] as [number, number],
  },
};

// ---------------------------------------------------------------------------
// Layout (game coordinates) — tweak to move things around
// ---------------------------------------------------------------------------

/** Center of the letters of "KOMEDIE" inside komedie.svg (in SVG pixels). */
const TITLE_SVG_CENTER = { x: 625.5, y: 320 };
/** Center of the title on screen, and its size. */
const TITLE = { x: 918, y: 627, scale: 0.898 };
/** Time between two letters falling in. */
const TITLE_LETTER_DELAY = 70;
/** The title goes on to the intro by itself after this many ms (a button press goes on sooner). */
const TITLE_TIME = 4500;

/**
 * Title: a blue and a red balloon; width = size on screen (game pixels).
 * Intro: they go next to the cards (blue = player 1, red = player 2).
 */
const TOOL_SPOTS = {
  title: { blue: { x: 359, y: 462, width: 230 }, red: { x: 1292, y: 908, width: 230 } },
  intro: { blue: { x: 588, y: 805, width: 165 }, red: { x: 1385, y: 705, width: 170 } },
};

/** Cards stand with the end of their stick below the screen. */
const BOTTOM_Y = GAME_HEIGHT + 40;
const CARDS = {
  p1: { key: 'km-card-p1', file: 'speler2-stap1-1.svg', x: 326, scale: 0.875 },
  p2: { key: 'km-card-p2', file: 'speler2-stap1.svg', x: 1660, scale: 0.875 },
};
/** The intro sign hangs from the top (its post goes up off the screen). */
const SIGN = { x: GAME_WIDTH / 2, y: -8, scale: 0.88 };
/** The brown "Druk op een knop om te starten" button. */
const START_BUTTON = { x: GAME_WIDTH / 2, y: 1090, width: 750 };

/**
 * Walkers (walk / walkFall) stand with their feet here and turn around at these x positions.
 * (Also whoever falls off the ball when it bursts: it walks on over the floor.)
 */
const FLOOR_Y = 1190;
const WALK_RANGE = { min: 520, max: 1720 };
/**
 * The podium in the middle (opstapding.svg, stretched to the design's size).
 * bounce: hidden = feet so low that the head is just under the rim; peeking up = feet `up` higher;
 * peeking sideways = `sideX` to the left or right, feet on the floor at `sideFeetY`, leaning `sideLean` degrees.
 * Everything below `cropY` (the bottom of the podium) is cut off, so the legs never show under it
 * while hidden (sideFeetY is just above it, so the feet show when peeking sideways).
 */
const PODIUM = {
  x: 952, y: 970, width: 485, height: 360,
  hiddenFeetY: 1250, up: 270, sideX: 235, sideFeetY: 1136, sideLean: 14, cropY: 1142,
};
/** opstapding.svg is 627 x 255 (content); shown 285 high so its bottom edge and shadow fit. */
const PODIUM_SVG = { width: 627, contentHeight: 255, height: 285 };
/** The big ball on the right: rolls between these x positions; y = where it touches the floor. */
const BALL = { width: 337, y: 1235, minX: 1480, maxX: 1720 };
/** Center and size of the flyers' figure-eight (over the left half, where the design has it). */
const FLY = { x: 820, y: 640, rangeX: 420, rangeY: 130 };
/**
 * The trapeze hangs from (x, y), far above the screen, so it swings across the whole top.
 * rope = distance from there to the bar (game pixels). The bar passes the middle at y + rope.
 */
const TRAPEZE = { x: GAME_WIDTH / 2, y: -1300, rope: 1920 };
/** In swing.svg (shown at its own size): the middle between the ropes, the top of the bar, and the ropes. */
const SWING_SVG = { width: 309, height: 663, ropesX: 153, barY: 607, ropeLefts: [38.4, 255.5], ropeWidth: 12.5, color: 0x41a1c5 };
/** The quote sign hangs from the top (its post goes up off the screen). */
const QUOTE_SIGN = { x: GAME_WIDTH / 2, y: -14, width: 700 };
/** Quote bubble after a hit, next to the character (up and to the left, like in the design). */
const SPOTLIGHT = {
  /** The rest of the scene goes this dark. */
  dim: 0.7,
  /** The character comes to the middle, as big as fits in maxWidth x maxHeight. */
  x: 960, y: 640, maxWidth: 800, maxHeight: 720,
  /** Its quote: up and to the left of the middle, tilted. */
  bubble: { dx: -400, dy: -235, width: 540, angle: -10 },
};
/** "FOUT!" (fout.svg) next to a wrong character, on the side towards the middle of the screen. */
const FOUT = { width: 230 };
/** Hit by one player (the other still has to): a small balloon of that player's colour above the character. */
const TEAM_MARK = { width: 70, dx: 40 };
/** The waiting balloons at the bottom edge: thrown from here, and a new one comes up. */
const LAUNCH = { 1: { x: 700, y: 1250 }, 2: { x: 1213, y: 1250 } } as const;
const LAUNCH_WIDTH = 190;
const AIM_WIDTH = 80;
/** The cannon (bottom left); muzzle = where things come out, as a fraction of the image. */
const CANNON = { x: 205, y: 1090, width: 650, muzzle: { x: 0.84, y: 0.19 } };
/** Shot from the cannon: a curve from the muzzle, bent towards `control`, to `end` (off the screen on the right). */
const CANNON_SHOT = { control: { x: 1100, y: 250 }, end: { x: GAME_WIDTH + 320, y: 480 } };
/** Ending: where the book lands, and how big it gets. */
const BOOK = { x: GAME_WIDTH / 2, y: 650, flyWidth: 150, closedWidth: 600, openWidth: 1520 };

/** Draw order (higher = on top). */
const DEPTH = {
  background: 0,
  tent: 1,
  decor: 2,
  actors: 3,
  content: 5,
  lying: 6,
  tools: 6,
  effects: 7,
  balloon: 8,
  sign: 9,
  bubble: 10,
  text: 11,
  overlay: 12,
  book: 13,
  endText: 14,
  spotDim: 15,
  spotActor: 16,
  spotBubble: 17,
  backButton: 20,
  aim: 30,
};

const FONT = 'Oswald';
const SIGN_FONT = 'Andika';

type State = 'title' | 'titleReady' | 'busy' | 'intro' | 'introReady' | 'play' | 'ending' | 'done';
type Player = 1 | 2;
type Body = GameObjects.Image | GameObjects.Container;

/** walkFall: tripping over and getting up again. */
type Trip = 'none' | 'falling' | 'lying' | 'rising';
const TRIP = { angle: 85, fallTime: 0.35, lieTime: 0.9, riseTime: 0.45 };

/** One character on stage. */
interface Actor {
  def: ComedyCharacter;
  /** How it moves now: the one from the data file, but it can change (e.g. 'ball' -> 'walkFall' when the ball bursts). */
  movement: Movement;
  /** Moves around; holds the body, its prop (ball or trapeze) and the hint glow. */
  container: GameObjects.Container;
  body: Body;
  prop?: GameObjects.Image;
  /** free = moving around; down = hit (knocked over). */
  state: 'free' | 'down';
  /** Seconds since it started moving (drives the movement). */
  t: number;
  dir: 1 | -1;
  /** y of the body inside the container. */
  baseY: number;
  trip: Trip;
  tripTimer: number;
  tripAngle: number;
  /** bounce: hidden behind the podium, coming out, out, going back; which way it peeks. */
  peek: 'hidden' | 'out' | 'hold' | 'in';
  peekTimer: number;
  peekKind: 'up' | 'left' | 'right';
  /** cannon: the number of the current shot (a new number = fire the cannon). */
  lastShot: number;
  /** Shakes (after a wrong hit) until this time. */
  shakeUntil: number;
  /** When each player last hit it while it was the right one, and the little balloon shown for that. */
  teamHits: Partial<Record<Player, number>>;
  teamMarks: Partial<Record<Player, GameObjects.Image>>;
}

export class KomedieScene extends Scene {
  private state: State = 'title';
  private letters: GameObjects.Image[] = [];
  /** The red balloon of the title and intro (player 2). */
  private balloon?: GameObjects.Image;
  private pointers!: PlayerPointers;
  /** Everything of the intro that goes away when the game starts. */
  private introObjects: GameObjects.Image[] = [];
  /** Player 1's balloon in the intro (the red one is `balloon`). */
  private blueBalloon?: GameObjects.Image;
  /** The balloon waiting at the bottom edge for each player. */
  private waiting: Record<Player, GameObjects.Image | undefined> = { 1: undefined, 2: undefined };

  // Play
  private actors: Actor[] = [];
  /** The actors in the order of their quotes. */
  private round: Actor[] = [];
  private current = 0;
  /** ask = waiting for the right hit; reveal = showing who said it. */
  private phase: 'ask' | 'reveal' = 'ask';
  private askedAt = 0;
  private hintActor?: Actor;
  private quoteSign?: Body;
  private aims!: Record<Player, GameObjects.Image>;
  private lastThrow: Record<Player, number> = { 1: -Infinity, 2: -Infinity };
  private cannon?: GameObjects.Image;

  constructor() {
    super('KomedieScene');
  }

  preload() {
    this.load.image('km-background', PATH + 'background.jpg');
    this.load.image('km-tent', PATH + 'background-color.png');
    this.load.svg('km-balloon', PATH + 'ballon.svg', { scale: RENDER_SCALE });
    // Also as text: recoloured into the blue balloon of player 1 (see makeBlueBalloon).
    this.load.text('km-balloon-svg', PATH + 'ballon.svg');
    this.load.svg('km-sign', PATH + 'sign.svg', { scale: RENDER_SCALE });
    // As text: opstapding.svg is cut off at the bottom, so it gets extra room first (see makePodium).
    this.load.text('km-podium-svg', PATH + 'opstapding.svg');
    preloadStartButton(this);
    Object.values(CARDS).forEach((card) => this.load.svg(card.key, PATH + card.file, { scale: RENDER_SCALE }));
    // Loaded as text: split into one image per letter (see svgParts.ts).
    this.load.text('km-title', PATH + 'komedie.svg');

    // The game.
    const svg = (key: string, file: string) => this.load.svg(key, PATH + file, { scale: RENDER_SCALE });
    svg('km-aim-1', 'aim-blue.svg');
    svg('km-aim-2', 'aim-red.svg');
    svg('km-splash', 'splash.svg');
    svg('km-ball', 'bal.svg');
    svg('km-swing', 'swing.svg');
    svg('km-cannon', 'canon.svg');
    svg('km-smoke', 'wolk.svg');
    svg('km-fout', 'fout.svg');
    for (const def of COMEDY_CHARACTERS.filter((c) => c.enabled)) {
      svg(charKey(def), def.image);
      svg(signKey(def), def.sign);
      svg(quoteKey(def), def.quoteCard);
      if (def.audio) this.load.audio(audioKey(def), PATH + def.audio);
    }

    // Shared with the geschiedenis game.
    this.load.image('km-back', 'assets/minigame-geschiedenis/back-button.png');
    this.load.image('km-book', 'assets/minigame-geschiedenis/book.png');
    this.load.image('km-book-open', 'assets/minigame-geschiedenis/book-1.png');
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

    this.state = 'title';
    this.letters = [];
    this.balloon = undefined;
    this.introObjects = [];
    this.actors = [];
    this.round = [];
    this.current = 0;
    this.phase = 'ask';
    this.hintActor = undefined;
    this.quoteSign = undefined;
    this.lastThrow = { 1: -Infinity, 2: -Infinity };
    this.cannon = undefined;
    this.blueBalloon = undefined;
    this.waiting = { 1: undefined, 2: undefined };

    this.add.image(0, 0, 'km-background').setOrigin(0).setDisplaySize(GAME_WIDTH, GAME_HEIGHT).setDepth(DEPTH.background);

    // The players' hands as the cursor (during the game: the aims instead).
    this.pointers = new PlayerPointers(this);
    this.pointers.show();
    // Both players have their own pointer (player 1 controller, player 2 mouse).
    inputManager.setSplit(this);

    const makeAim = (player: Player) => {
      const aim = this.add.image(0, 0, `km-aim-${player}`).setDepth(DEPTH.aim).setVisible(false);
      return aim.setScale(AIM_WIDTH / aim.width);
    };
    this.aims = { 1: makeAim(1), 2: makeAim(2) };

    this.addBackButton();

    this.input.on('pointerup', this.pressButton, this);
    inputManager.on('select', this.onSelect, this);
    inputManager.on('shake', this.onShake, this);
    this.events.once('shutdown', () => {
      this.input.off('pointerup', this.pressButton, this);
      inputManager.off('select', this.onSelect, this);
      inputManager.off('shake', this.onShake, this);
    });

    void this.showTitle();
  }

  /** "The button": a click, or player 1's controller button (which also arrives as a click). */
  private pressButton() {
    if (this.state === 'titleReady') this.showIntro();
    else if (this.state === 'introReady') this.startGame();
  }

  // --- Input from the InputManager -------------------------------------------

  /** A click (player 2: the mouse, or player 2's controller button) or player 1's button: throw. */
  private onSelect(event: { player?: number }) {
    if (this.state === 'play') this.throwBalloon(event.player === 1 ? 1 : 2);
  }

  /** The throw gesture (shake): throw, or go on from the title/intro. */
  private onShake(event: { player: number }) {
    if (this.state === 'play') this.throwBalloon(event.player === 1 ? 1 : 2);
    else this.pressButton();
  }

  private addBackButton() {
    const button = this.add
      .image(110, 84, 'km-back')
      .setScale(95 / 335)
      .setDepth(DEPTH.backButton)
      .setInteractive()
      .on('pointerup', (_p: Input.Pointer, _x: number, _y: number, event: Types.Input.EventData) => {
        // Don't let this click also count as "the button".
        event.stopPropagation();
        // Fade to black, then back to the genre choice in the menu (without the title screen).
        this.input.enabled = false;
        this.state = 'busy';
        this.cameras.main.fadeOut(400, 0, 0, 0);
        this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('MenuScene', { skipTitle: true }));
      });
    popIn(this, button, { delay: 300 });
  }

  // ---------------------------------------------------------------------------
  // Title
  // ---------------------------------------------------------------------------

  private async showTitle() {
    const [title] = await Promise.all([
      loadSvgParts(this, this.cache.text.get('km-title'), 'km-title', RENDER_SCALE),
      this.makeBlueBalloon(),
      this.makePodium(),
    ]);
    // The player may have left the scene while the letters were being prepared.
    if (!this.sys.isActive() || this.state !== 'title') return;

    // Letters fall in one by one, like puppets on a string.
    this.letters = title.parts.map((part, i) => {
      const letter = this.add
        .image(
          TITLE.x + (part.x - TITLE_SVG_CENTER.x) * TITLE.scale,
          TITLE.y + (part.y - TITLE_SVG_CENTER.y) * TITLE.scale,
          part.key,
        )
        .setScale(TITLE.scale / RENDER_SCALE)
        .setDepth(DEPTH.content);
      dropIn(this, letter, { delay: 200 + i * TITLE_LETTER_DELAY, distance: 900 });
      return letter;
    });

    // Then the blue and the red balloon come in. They stay for the intro.
    const toolsDelay = 400 + this.letters.length * TITLE_LETTER_DELAY;
    const { blue: b, red: r } = TOOL_SPOTS.title;
    const blue = this.add.image(b.x, b.y, this.balloonKey(1)).setDepth(DEPTH.tools);
    blue.setScale(b.width / blue.width);
    const red = this.add.image(r.x, r.y, 'km-balloon').setDepth(DEPTH.tools);
    red.setScale(r.width / red.width);
    this.blueBalloon = blue;
    this.balloon = red;
    slideIn(this, blue, 'left', { delay: toolsDelay, sway: false, onComplete: () => this.float(blue) });
    slideIn(this, red, 'right', { delay: toolsDelay + 150, sway: false, onComplete: () => this.float(red) });

    this.time.delayedCall(toolsDelay + 600, () => {
      if (this.state === 'title') this.state = 'titleReady';
    });
    this.time.delayedCall(TITLE_TIME, () => {
      if (this.state === 'titleReady') this.showIntro();
    });
  }

  // ---------------------------------------------------------------------------
  // Intro
  // ---------------------------------------------------------------------------

  private showIntro() {
    this.state = 'busy';

    // The letters go down, one after the other.
    const letters = this.letters;
    this.letters = [];
    letters.forEach((letter, i) => sinkOut(this, letter, { delay: i * 30, onComplete: () => letter.destroy() }));

    // The balloons move next to the cards: blue to player 1, red to player 2.
    this.moveTool(this.blueBalloon, TOOL_SPOTS.intro.blue, (balloon) => this.float(balloon));
    this.moveTool(this.balloon, TOOL_SPOTS.intro.red, (balloon) => this.float(balloon));

    // The sign comes down from the top once and hangs still (its post stays off the screen).
    const sign = this.add
      .image(SIGN.x, SIGN.y - 600, 'km-sign')
      .setOrigin(0.5, 0)
      .setScale(SIGN.scale / RENDER_SCALE)
      .setDepth(DEPTH.content);
    this.tweens.add({ targets: sign, y: SIGN.y, delay: 300, duration: 800, ease: 'Cubic.Out' });
    this.introObjects.push(sign);

    // The cards come up on their sticks.
    for (const [i, card] of [CARDS.p1, CARDS.p2].entries()) {
      const image = this.add
        .image(card.x, BOTTOM_Y, card.key)
        .setOrigin(0.5, 1)
        .setScale(card.scale / RENDER_SCALE)
        .setDepth(DEPTH.content);
      riseIn(this, image, { delay: 550 + i * 150, gentle: true });
      this.introObjects.push(image);
    }

    const button = addStartButton(this, START_BUTTON.x, START_BUTTON.y, { width: START_BUTTON.width, depth: DEPTH.content, delay: 900 });
    this.introObjects.push(button);

    this.time.delayedCall(1400, () => (this.state = 'introReady'));
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

  /** The balloon floats up and down and sways a little. */
  private float(balloon: GameObjects.Image) {
    this.tweens.add({ targets: balloon, y: balloon.y - 24, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    this.tweens.add({ targets: balloon, angle: { from: -5, to: 5 }, duration: 1900, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
  }

  // ---------------------------------------------------------------------------
  // Start of the game
  // ---------------------------------------------------------------------------

  private startGame() {
    this.state = 'busy';

    // The intro goes: the sign back up, the cards and the button down.
    const intro = this.introObjects;
    this.introObjects = [];
    intro.forEach((object, i) => {
      if (object.texture.key === 'km-sign') {
        this.tweens.add({ targets: object, y: object.y - 700, duration: 600, ease: 'Back.In', onComplete: () => object.destroy() });
      } else {
        sinkOut(this, object, { delay: i * 60, onComplete: () => object.destroy() });
      }
    });

    // The circus tent.
    const tent = this.add.image(0, 0, 'km-tent').setOrigin(0).setDisplaySize(GAME_WIDTH, GAME_HEIGHT).setDepth(DEPTH.tent);
    tent.setAlpha(0);
    this.tweens.add({ targets: tent, alpha: 1, duration: 700, delay: 300 });

    this.cannon = this.add.image(CANNON.x, CANNON.y, 'km-cannon').setDepth(DEPTH.decor);
    this.cannon.setScale(CANNON.width / this.cannon.width);
    slideIn(this, this.cannon, 'left', { delay: 600, sway: false });

    // The podium in the middle: in front of whoever jumps out of it, behind the rest.
    // PODIUM.height is the height of the drawing itself; the extra room below comes on top of that.
    const podium = this.add.image(PODIUM.x, PODIUM.y, 'km-podium').setDepth(DEPTH.actors + 0.05);
    podium.setOrigin(0.5, PODIUM_SVG.contentHeight / 2 / PODIUM_SVG.height);
    podium.setDisplaySize(PODIUM.width, (PODIUM.height * PODIUM_SVG.height) / PODIUM_SVG.contentHeight);
    riseIn(this, podium, { delay: 600, sway: false, distance: 500 });

    // The intro balloons go down to the bottom edge: those are the ones the players throw.
    const red = this.balloon;
    const blue = this.blueBalloon;
    this.balloon = undefined;
    this.blueBalloon = undefined;
    this.waiting = { 1: undefined, 2: undefined };
    for (const [player, balloon] of [[1, blue], [2, red]] as const) {
      if (!balloon) {
        this.reload(player, 600);
        continue;
      }
      this.tweens.killTweensOf(balloon);
      this.tweens.add({
        targets: balloon,
        x: LAUNCH[player].x,
        y: LAUNCH[player].y,
        scale: LAUNCH_WIDTH / balloon.width,
        angle: 0,
        duration: 900,
        ease: 'Back.InOut',
        onComplete: () => (this.waiting[player] = balloon),
      });
      balloon.setDepth(DEPTH.balloon);
    }

    // Pick the characters of this round; their quotes come in a random order.
    const defs = shuffle(COMEDY_CHARACTERS.filter((c) => c.enabled)).slice(0, CONFIG.CHARACTERS_PER_ROUND);
    this.actors = defs.map((def, i) => this.createActor(def, i));
    // (The cannon character comes out of the cannon by itself.)
    this.actors
      .filter((actor) => actor.movement !== 'cannon')
      .forEach((actor, i) => popIn(this, actor.container, { delay: 700 + i * 150 }));
    this.round = shuffle(this.actors);
    this.current = 0;

    this.time.delayedCall(1500, () => {
      if (this.state !== 'busy') return;
      this.state = 'play';
      // Aims instead of the hands.
      this.pointers.hide();
      this.input.setDefaultCursor('none');
      this.nextQuote();
    });
  }

  // ---------------------------------------------------------------------------
  // Characters
  // ---------------------------------------------------------------------------

  private createActor(def: ComedyCharacter, index: number): Actor {
    // Whoever jumps out of the podium is behind it; the others are in front of it.
    const depth = DEPTH.actors + (def.movement === 'bounce' ? 0 : 0.1 + index * 0.01);
    const container = this.add.container(0, 0).setDepth(depth);
    const body = this.makeBody(def);
    const height = def.height;
    let prop: GameObjects.Image | undefined;
    let ropes: GameObjects.Graphics | undefined;
    let baseY = 0;
    const startX = PMath.Between(WALK_RANGE.min, WALK_RANGE.max);

    let t = Math.random() * 20;
    switch (def.movement) {
      case 'bounce':
        // Hidden behind the podium (the podium is in front of it).
        container.setPosition(PODIUM.x, PODIUM.hiddenFeetY);
        break;
      case 'cannon':
        // The container is the middle of the character. The first shot comes 1.5 s after the start.
        baseY = height / 2;
        container.setPosition(this.muzzle().x, this.muzzle().y).setVisible(false);
        t = -1.5;
        break;
      case 'ball': {
        // Origin in the middle, so the ball rolls around its own center.
        prop = this.add.image(0, 0, 'km-ball');
        prop.setScale(BALL.width / prop.width).setY(-prop.displayHeight / 2);
        // Standing on top of the ball (a bit sunk in, so the feet touch it).
        baseY = -prop.displayHeight * 0.92;
        container.setPosition(PMath.Between(BALL.minX, BALL.maxX), BALL.y);
        break;
      }
      case 'walk':
      case 'walkFall':
        container.setPosition(startX, FLOOR_Y);
        break;
      case 'fly':
        // The container is the middle of the character (positions: see moveActor).
        baseY = height / 2;
        break;
      case 'swing': {
        // The trapeze at its own size, with the bar `rope` below the point it hangs from.
        const top = TRAPEZE.rope - SWING_SVG.barY;
        prop = this.add.image(0, top, 'km-swing').setOrigin(SWING_SVG.ropesX / SWING_SVG.width, 0);
        prop.setScale(SWING_SVG.height / prop.height);
        // Longer ropes, up to the hanging point (white sticker edge + blue, like in swing.svg).
        ropes = this.add.graphics();
        for (const left of SWING_SVG.ropeLefts) {
          const x = left - SWING_SVG.ropesX;
          ropes.fillStyle(0xffffff, 1).fillRect(x - 9, 0, SWING_SVG.ropeWidth + 18, top + 4);
          ropes.fillStyle(SWING_SVG.color, 1).fillRect(x, 0, SWING_SVG.ropeWidth, top + 4);
        }
        // Lying over the bar: the bar crosses the lower quarter of the character.
        baseY = TRAPEZE.rope + height * 0.25;
        container.setPosition(TRAPEZE.x, TRAPEZE.y);
        break;
      }
    }
    body.y = baseY;

    container.add([ropes, prop, body].filter((o) => o !== undefined));

    const [minFall, maxFall] = CONFIG.SPEED.fallEvery;
    return {
      def,
      movement: def.movement,
      container,
      body,
      prop,
      state: 'free',
      t,
      dir: Math.random() < 0.5 ? 1 : -1,
      baseY,
      trip: 'none',
      tripTimer: PMath.FloatBetween(minFall, maxFall),
      tripAngle: 0,
      peek: 'hidden',
      peekTimer: PMath.FloatBetween(...CONFIG.SPEED.peekHidden),
      peekKind: 'up',
      lastShot: -1,
      shakeUntil: 0,
      teamHits: {},
      teamMarks: {},
    };
  }

  /** The character's image (bottom middle = its feet), or a placeholder if the image is missing. */
  private makeBody(def: ComedyCharacter): Body {
    if (this.textures.exists(charKey(def))) {
      const image = this.add.image(0, 0, charKey(def)).setOrigin(0.5, 1);
      return image.setScale(def.height / image.height);
    }
    // Placeholder: a coloured sticker with the name.
    const w = def.height * 0.6;
    const h = def.height;
    const box = this.add.graphics();
    box.fillStyle(0xffffff, 1).fillRoundedRect(-w / 2 - 8, -h - 8, w + 16, h + 16, 28);
    box.fillStyle(0x7b5ea7, 1).fillRoundedRect(-w / 2, -h, w, h, 22);
    const name = this.add
      .text(0, -h / 2, def.name, { fontFamily: FONT, fontSize: '30px', color: '#FFFFFF', align: 'center', wordWrap: { width: w - 16 }, resolution: RENDER_SCALE })
      .setOrigin(0.5);
    return this.add.container(0, 0, [box, name]);
  }

  update(_time: number, delta: number) {
    // At most 50 ms per frame, so nothing jumps after a hiccup.
    const dt = Math.min(delta, 50) / 1000;
    for (const actor of this.actors) this.moveActor(actor, dt);
    this.updateAims();

    if (this.state === 'play' && this.phase === 'ask' && !this.hintActor && this.time.now - this.askedAt > CONFIG.HINT_DELAY) {
      this.startHint(this.round[this.current]);
    }
  }

  private moveActor(actor: Actor, dt: number) {
    const S = CONFIG.SPEED;
    const { container, body } = actor;
    actor.t += dt;

    // The trapeze keeps swinging, also after its character fell off.
    if (actor.movement === 'swing') {
      container.angle = S.swingAngle * Math.sin((2 * Math.PI * actor.t) / S.swingTime);
    }
    if (actor.state !== 'free') return;

    let bob = 0;
    let wobble = 0;
    switch (actor.movement) {
      case 'walk':
      case 'walkFall':
        if (actor.movement === 'walkFall') this.updateTrip(actor, dt);
        if (actor.trip === 'none') {
          container.x += actor.dir * S.walk * dt;
          this.turnAtEdges(actor);
          bob = Math.abs(Math.sin(actor.t * 9)) * 14;
          wobble = Math.sin(actor.t * 9) * 4;
        }
        break;
      case 'bounce':
        wobble = this.updatePeek(actor, dt);
        break;
      case 'cannon': {
        // Not shot yet.
        if (actor.t < 0) {
          container.setVisible(false);
          return;
        }
        const cycle = S.cannonFlightTime + S.cannonPause;
        const shot = Math.floor(actor.t / cycle);
        if (shot !== actor.lastShot) {
          actor.lastShot = shot;
          this.cannonPuff();
        }
        const u = (actor.t % cycle) / S.cannonFlightTime;
        // Between two shots: inside the cannon.
        container.setVisible(u < 1);
        if (u >= 1) return;
        // A curve from the muzzle to off the screen on the right; it grows as it comes out of the cannon.
        const from = this.muzzle();
        const { control: c, end } = CANNON_SHOT;
        const a = (1 - u) * (1 - u);
        const b = 2 * u * (1 - u);
        container.setPosition(a * from.x + b * c.x + u * u * end.x, a * from.y + b * c.y + u * u * end.y);
        container.setScale(Math.min(1, 0.3 + u * 6));
        // Tilt along the curve (half of it, so it stays readable).
        const dx = 2 * (1 - u) * (c.x - from.x) + 2 * u * (end.x - c.x);
        const dy = 2 * (1 - u) * (c.y - from.y) + 2 * u * (end.y - c.y);
        wobble = PMath.RadToDeg(Math.atan2(dy, dx)) * 0.5;
        break;
      }
      case 'ball': {
        this.updateTrip(actor, dt);
        if (actor.trip === 'none') {
          const step = actor.dir * S.ball * dt;
          container.x += step;
          if (container.x < BALL.minX) actor.dir = 1;
          if (container.x > BALL.maxX) actor.dir = -1;
          container.x = PMath.Clamp(container.x, BALL.minX, BALL.maxX);
          // The ball rolls along; the character walks on top and leans to keep its balance.
          if (actor.prop) actor.prop.angle += PMath.RadToDeg(step / (actor.prop.displayWidth / 2));
          bob = Math.abs(Math.sin(actor.t * 8)) * 6;
          wobble = Math.sin(actor.t * 3) * 6 - actor.dir * 4;
        }
        break;
      }
      case 'fly': {
        const p = (actor.t * 2 * Math.PI) / S.flyLoopTime;
        container.setPosition(FLY.x + FLY.rangeX * Math.sin(p), FLY.y + FLY.rangeY * Math.sin(2 * p));
        actor.dir = Math.cos(p) >= 0 ? 1 : -1;
        wobble = Math.sin(actor.t * 5) * 6;
        break;
      }
      case 'swing':
        break;
    }

    const shake = this.time.now < actor.shakeUntil ? Math.sin(actor.t * 70) * 12 : 0;
    const hint = this.hintActor === actor ? Math.sin(actor.t * 14) * 8 : 0;
    body.angle = wobble + actor.tripAngle + shake + hint;
    body.y = actor.baseY - bob;
    // Walkers and flyers face the way they move.
    const turns = ['walk', 'walkFall', 'fly'].includes(actor.movement);
    const facing = turns ? actor.dir : 1;
    body.scaleX = Math.abs(body.scaleX) * facing;

    if (actor.movement === 'bounce') this.cropBelow(actor, PODIUM.cropY);
  }

  /**
   * bounce: hide behind the podium, and now and then peek out (up, or to the left or right side),
   * stay out for a moment and go back. Returns the lean (degrees).
   */
  private updatePeek(actor: Actor, dt: number): number {
    const S = CONFIG.SPEED;
    actor.peekTimer -= dt;
    // While the hint is on, don't stay hidden long.
    if (this.hintActor === actor && actor.peek === 'hidden') actor.peekTimer = Math.min(actor.peekTimer, S.peekHiddenHint);

    let out = 0;
    switch (actor.peek) {
      case 'hidden':
        if (actor.peekTimer <= 0) {
          actor.peek = 'out';
          actor.peekTimer = S.peekMove;
          actor.peekKind = (['up', 'left', 'right'] as const)[PMath.Between(0, 2)];
        }
        break;
      case 'out':
        out = PMath.Easing.Back.Out(1 - Math.max(actor.peekTimer, 0) / S.peekMove);
        if (actor.peekTimer <= 0) {
          actor.peek = 'hold';
          actor.peekTimer = S.peekHold;
        }
        break;
      case 'hold':
        out = 1;
        if (actor.peekTimer <= 0) {
          actor.peek = 'in';
          actor.peekTimer = S.peekMove;
        }
        break;
      case 'in':
        out = PMath.Easing.Quadratic.In(Math.max(actor.peekTimer, 0) / S.peekMove);
        if (actor.peekTimer <= 0) {
          actor.peek = 'hidden';
          actor.peekTimer = PMath.FloatBetween(...S.peekHidden);
        }
        break;
    }

    const side = actor.peekKind === 'left' ? -1 : actor.peekKind === 'right' ? 1 : 0;
    const feetY = side === 0 ? PODIUM.hiddenFeetY - PODIUM.up : PODIUM.sideFeetY;
    actor.container.setPosition(PODIUM.x + side * PODIUM.sideX * out, PMath.Linear(PODIUM.hiddenFeetY, feetY, out));
    // Lean out to the side; a little wiggle while out.
    const wiggle = actor.peek === 'hold' ? Math.sin(actor.t * 5) * 3 : 0;
    return side * PODIUM.sideLean * out + wiggle;
  }

  /** Cut off the part of the character below a line (e.g. under the podium, so the legs don't show). */
  private cropBelow(actor: Actor, limitY: number) {
    const body = actor.body;
    if (!(body instanceof GameObjects.Image)) return;
    const feet = actor.container.y + body.y;
    const top = feet - body.displayHeight;
    const visible = PMath.Clamp(limitY - top, 0, body.displayHeight);
    body.setCrop(0, 0, body.frame.width, visible / body.scaleY);
  }

  private turnAtEdges(actor: Actor) {
    const c = actor.container;
    if (c.x < WALK_RANGE.min) {
      c.x = WALK_RANGE.min;
      actor.dir = 1;
    } else if (c.x > WALK_RANGE.max) {
      c.x = WALK_RANGE.max;
      actor.dir = -1;
    }
  }

  /** walkFall: now and then trip, lie down for a moment and get up again. */
  private updateTrip(actor: Actor, dt: number) {
    actor.tripTimer -= dt;
    const fallen = TRIP.angle * actor.dir;
    switch (actor.trip) {
      case 'none':
        if (actor.tripTimer <= 0) {
          actor.trip = 'falling';
          actor.tripTimer = TRIP.fallTime;
        }
        break;
      case 'falling':
        actor.tripAngle = fallen * PMath.Easing.Quadratic.In(1 - Math.max(actor.tripTimer, 0) / TRIP.fallTime);
        if (actor.tripTimer <= 0) {
          actor.trip = 'lying';
          actor.tripTimer = TRIP.lieTime;
        }
        break;
      case 'lying':
        actor.tripAngle = fallen;
        if (actor.tripTimer <= 0) {
          actor.trip = 'rising';
          actor.tripTimer = TRIP.riseTime;
        }
        break;
      case 'rising':
        actor.tripAngle = fallen * (Math.max(actor.tripTimer, 0) / TRIP.riseTime);
        if (actor.tripTimer <= 0) {
          actor.trip = 'none';
          actor.tripAngle = 0;
          actor.tripTimer = PMath.FloatBetween(...CONFIG.SPEED.fallEvery);
        }
        break;
    }
  }

  /** Hint: the right character wiggles (see moveActor). */
  private startHint(actor: Actor | undefined) {
    this.hintActor = actor;
  }

  private stopHint() {
    this.hintActor = undefined;
  }

  /** Does a balloon landing at (x, y) hit this character? */
  private isHit(actor: Actor, x: number, y: number) {
    if (actor.state !== 'free' || !actor.container.visible) return false;
    const b = actor.body.getBounds();
    const p = CONFIG.HITBOX_PADDING;
    if (x < b.x - p || x > b.right + p || y < b.y - p || y > b.bottom + p) return false;
    // Behind the podium: only the part that sticks out counts.
    if (actor.movement === 'bounce') {
      const podiumTop = PODIUM.y - PODIUM.height / 2 + 25;
      const inPodium = Math.abs(x - PODIUM.x) < PODIUM.width / 2 - 20 && y > podiumTop;
      if (inPodium || y > PODIUM.cropY) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Quotes
  // ---------------------------------------------------------------------------

  private nextQuote() {
    if (this.state !== 'play') return;
    const actor = this.round[this.current];
    if (!actor) {
      this.showEnding();
      return;
    }

    this.phase = 'ask';
    this.stopHint();
    const sign = this.makeSign(actor.def);
    dropIn(this, sign, { distance: 500 });
    this.quoteSign = sign;
    // The hint timer starts when the sign has come down.
    this.askedAt = this.time.now + 700;
  }

  /** The wooden sign with the quote (without the name), hanging from the top. */
  private makeSign(def: ComedyCharacter): Body {
    const { x, y, width } = QUOTE_SIGN;
    if (this.textures.exists(signKey(def))) {
      const sign = this.add.image(x, y, signKey(def)).setOrigin(0.5, 0).setDepth(DEPTH.sign);
      return sign.setScale(width / sign.width);
    }
    // Placeholder: a wooden board with the text.
    const h = 260;
    const board = this.add.graphics();
    board.fillStyle(0xffffff, 1).fillRoundedRect(-width / 2 - 8, 70, width + 16, h - 50, 16);
    board.fillStyle(0x7a4a2a, 1).fillRect(-18, 0, 36, 90).fillRoundedRect(-width / 2, 78, width, h - 66, 12);
    const label = this.add
      .text(0, 120, 'Wie zegt deze quote?', { fontFamily: SIGN_FONT, fontStyle: '700', fontSize: '28px', color: '#FFFFFF', resolution: RENDER_SCALE })
      .setOrigin(0.5);
    const quote = this.add
      .text(0, 185, `“ ${def.quote} ”`, {
        fontFamily: SIGN_FONT, fontStyle: '700', fontSize: '42px', color: '#FFFFFF', align: 'center',
        wordWrap: { width: width - 60 }, resolution: RENDER_SCALE,
      })
      .setOrigin(0.5);
    return this.add.container(x, y, [board, label, quote]).setDepth(DEPTH.sign);
  }

  /** The big speech bubble with the quote and the name. */
  private makeQuoteBubble(def: ComedyCharacter, x: number, y: number): Body {
    if (this.textures.exists(quoteKey(def))) {
      const bubble = this.add.image(x, y, quoteKey(def)).setDepth(DEPTH.bubble).setAngle(-2);
      return bubble.setScale(SPOTLIGHT.bubble.width / bubble.width);
    }
    const w = SPOTLIGHT.bubble.width;
    const h = 220;
    const card = this.add.graphics();
    card.fillStyle(0xffffff, 1).fillRoundedRect(-w / 2, -h / 2, w, h, 30);
    const quote = this.add
      .text(0, -22, def.quote, {
        fontFamily: FONT, fontStyle: '700', fontSize: '50px', color: '#0F3550', align: 'center',
        wordWrap: { width: w - 60 }, resolution: RENDER_SCALE,
      })
      .setOrigin(0.5);
    const name = this.add
      .text(0, 58, def.name, { fontFamily: FONT, fontSize: '28px', color: '#4FA3B8', resolution: RENDER_SCALE })
      .setOrigin(0.5);
    return this.add.container(x, y, [card, quote, name]).setDepth(DEPTH.bubble).setAngle(-2);
  }

  // ---------------------------------------------------------------------------
  // Throwing
  // ---------------------------------------------------------------------------

  /** Where a player aims: player 1 = controller cursor, player 2 = mouse. */
  private aimOf(player: Player) {
    const p = inputManager.getPlayerCursor(player);
    return { x: PMath.Clamp(p.x, 0, GAME_WIDTH), y: PMath.Clamp(p.y, 0, GAME_HEIGHT) };
  }

  private updateAims() {
    const playing = this.state === 'play';
    for (const player of [1, 2] as const) {
      // Player 1 only has an aim when a controller is in use.
      const show = playing && (player === 2 || inputManager.getMode() === 'tilt');
      const aim = this.aims[player];
      aim.setVisible(show);
      if (show) {
        const { x, y } = this.aimOf(player);
        aim.setPosition(x, y);
      }
    }
  }

  private throwBalloon(player: Player) {
    const now = this.time.now;
    if (now - this.lastThrow[player] < CONFIG.THROW_COOLDOWN) return;
    this.lastThrow[player] = now;

    // The waiting balloon flies (or a fresh one, if the next one isn't up yet); a new one comes up.
    let balloon = this.waiting[player];
    this.waiting[player] = undefined;
    if (balloon) {
      this.tweens.killTweensOf(balloon);
    } else {
      balloon = this.add.image(LAUNCH[player].x, LAUNCH[player].y, this.balloonKey(player)).setDepth(DEPTH.balloon);
      balloon.setScale(LAUNCH_WIDTH / balloon.width);
    }
    this.reload(player, 150);

    const from = { x: balloon.x, y: balloon.y };
    const to = this.aimOf(player);
    const startScale = balloon.scale;
    const endScale = CONFIG.BALLOON_END_WIDTH / balloon.width;
    const spin = (player === 1 ? 1 : -1) * PMath.Between(180, 360);
    const flying = balloon;

    // A short arc towards the aim, getting smaller (further away).
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: CONFIG.BALLOON_FLIGHT_TIME,
      onUpdate: (tween) => {
        const t = tween.getValue() ?? 0;
        flying.setPosition(
          PMath.Linear(from.x, to.x, t),
          PMath.Linear(from.y, to.y, t) - CONFIG.BALLOON_ARC_HEIGHT * 4 * t * (1 - t),
        );
        flying.setScale(PMath.Linear(startScale, endScale, t)).setAngle(spin * t);
      },
      onComplete: () => {
        flying.destroy();
        this.balloonLands(to.x, to.y, player);
      },
    });
  }

  /** A new balloon comes up at the bottom edge. */
  private reload(player: Player, delay: number) {
    const { x, y } = LAUNCH[player];
    const balloon = this.add.image(x, y + 260, this.balloonKey(player)).setDepth(DEPTH.balloon);
    balloon.setScale(LAUNCH_WIDTH / balloon.width);
    this.tweens.add({
      targets: balloon,
      y,
      delay,
      duration: Math.max(CONFIG.THROW_COOLDOWN - delay, 150),
      ease: 'Back.Out',
      onComplete: () => {
        // Already one waiting (or the game is over): this one isn't needed.
        if (this.waiting[player] || this.state === 'ending' || this.state === 'done') balloon.destroy();
        else this.waiting[player] = balloon;
      },
    });
  }

  private balloonKey(player: Player) {
    return player === 1 && this.textures.exists('km-balloon-blue') ? 'km-balloon-blue' : 'km-balloon';
  }

  /** The balloon arrives: splash, and check what it hit. */
  private balloonLands(x: number, y: number, player: Player) {
    this.splash(x, y);
    if (this.state !== 'play') return;

    // The ball under a character bursts when it is hit (always, also between two quotes).
    const hits = this.phase === 'ask' ? this.actors.filter((actor) => this.isHit(actor, x, y)) : [];
    if (hits.length === 0) {
      const ball = this.actors.find((actor) => actor.movement === 'ball' && this.ballHit(actor, x, y));
      if (ball) this.popBall(ball);
      return;
    }

    // When characters overlap, the right one counts (kinder for the players).
    const target = this.round[this.current];
    if (hits.includes(target)) this.rightHit(target, player);
    else this.wrongHit(hits.sort((a, b) => b.container.depth - a.container.depth)[0]);
  }

  /** Is (x, y) on the ball of this character? (The ball is round, so: within its radius.) */
  private ballHit(actor: Actor, x: number, y: number) {
    const ball = actor.prop;
    if (!ball) return false;
    const center = { x: actor.container.x + ball.x, y: actor.container.y + ball.y };
    return Math.hypot(x - center.x, y - center.y) < (ball.displayWidth / 2) * 0.95 + CONFIG.HITBOX_PADDING / 2;
  }

  /**
   * The ball bursts (a puff), the character on it falls down to the floor, gets up
   * and walks on over the floor (walkFall: now and then it trips again).
   */
  private popBall(actor: Actor) {
    const ball = actor.prop;
    if (!ball) return;
    actor.prop = undefined;
    const center = { x: actor.container.x + ball.x, y: actor.container.y + ball.y };

    // Pop: the ball swells for a moment and is gone; a puff of smoke and a splash where it was.
    this.tweens.add({
      targets: ball,
      scale: ball.scale * 1.25,
      alpha: 0,
      duration: 140,
      ease: 'Quad.Out',
      onComplete: () => ball.destroy(),
    });
    const puff = this.add.image(center.x, center.y, 'km-smoke').setDepth(DEPTH.effects).setAngle(PMath.Between(-20, 20));
    const puffScale = (BALL.width * 1.3) / puff.width;
    puff.setScale(puffScale * 0.4);
    this.tweens.add({ targets: puff, scale: puffScale, duration: 220, ease: 'Back.Out' });
    this.tweens.add({ targets: puff, alpha: 0, scale: puffScale * 1.15, delay: 450, duration: 500, onComplete: () => puff.destroy() });
    this.splash(center.x, center.y);

    // A character already hit (in the spotlight or falling out) doesn't need to fall any more.
    if (actor.state !== 'free') return;

    // The character drops from the top of the ball to the floor, falling over on the way...
    const feetY = actor.container.y + actor.body.y;
    actor.container.y = feetY;
    actor.baseY = 0;
    actor.body.y = 0;
    actor.movement = 'walkFall';
    actor.trip = 'falling';
    actor.tripTimer = TRIP.fallTime;
    actor.container.x = PMath.Clamp(actor.container.x, WALK_RANGE.min, WALK_RANGE.max);
    // ...and lands with a little bounce. Then it lies for a moment, gets up and walks on (see updateTrip).
    this.tweens.add({ targets: actor.container, y: FLOOR_Y, duration: 550, ease: 'Bounce.Out' });
  }

  /** Two players play when a controller is in use (player 1 = controller, player 2 = mouse). */
  private bothPlayersNeeded() {
    return inputManager.getMode() === 'tilt';
  }

  /**
   * The right character is hit. With two players, both have to hit it (within TEAM_HIT_WINDOW of each other);
   * until then a small balloon of the player who hit it shows above it.
   */
  private rightHit(actor: Actor, player: Player) {
    if (!this.bothPlayersNeeded()) {
      this.correctHit(actor);
      return;
    }
    const now = this.time.now;
    const other: Player = player === 1 ? 2 : 1;
    const otherHit = actor.teamHits[other];
    if (otherHit !== undefined && now - otherHit <= CONFIG.TEAM_HIT_WINDOW) {
      this.correctHit(actor);
      return;
    }

    // First of the two: this player's balloon shows above it.
    actor.teamHits[player] = now;
    actor.teamMarks[player]?.destroy();
    const mark = this.add.image(0, 0, this.balloonKey(player));
    mark.setScale(TEAM_MARK.width / mark.width);
    mark.setPosition((player === 1 ? -1 : 1) * TEAM_MARK.dx, actor.baseY - actor.def.height - mark.displayHeight / 2);
    actor.container.add(mark);
    popIn(this, mark);
    actor.teamMarks[player] = mark;

    // Too late for the other player: it goes away again.
    this.time.delayedCall(CONFIG.TEAM_HIT_WINDOW, () => {
      if (actor.teamHits[player] !== now) return;
      delete actor.teamHits[player];
      this.removeTeamMark(actor, player);
    });
  }

  private removeTeamMark(actor: Actor, player: Player) {
    const mark = actor.teamMarks[player];
    delete actor.teamMarks[player];
    if (mark) this.tweens.add({ targets: mark, scale: 0, duration: 200, onComplete: () => mark.destroy() });
  }

  private splash(x: number, y: number) {
    const splash = this.add.image(x, y, 'km-splash').setDepth(DEPTH.effects).setAngle(PMath.Between(0, 360));
    const scale = 170 / splash.width;
    splash.setScale(scale * 0.3);
    this.tweens.add({ targets: splash, scale, duration: 160, ease: 'Back.Out' });
    this.tweens.add({ targets: splash, alpha: 0, delay: 450, duration: 450, onComplete: () => splash.destroy() });
  }

  /** Wrong character: it shakes and "FOUT!" pops up next to it (on the side towards the middle). */
  private wrongHit(actor: Actor) {
    actor.shakeUntil = this.time.now + 500;
    const box = actor.body.getBounds();
    const side = box.centerX > GAME_WIDTH / 2 ? -1 : 1;
    const label = this.add.image(0, 0, 'km-fout').setDepth(DEPTH.text).setAngle(-side * 6);
    label.setScale(FOUT.width / label.width);
    label.setPosition(
      PMath.Clamp(box.centerX + side * box.width * 0.45, FOUT.width / 2 + 20, GAME_WIDTH - FOUT.width / 2 - 20),
      PMath.Clamp(box.y + box.height * 0.25, 120, GAME_HEIGHT - 120),
    );
    popIn(this, label);
    this.tweens.add({ targets: label, alpha: 0, delay: CONFIG.WRONG_TIME, duration: 250, onComplete: () => label.destroy() });
  }

  /**
   * The right character, hit (by both players): it stands still while the balloon bursts on it,
   * then the spotlight.
   */
  private correctHit(actor: Actor) {
    this.phase = 'reveal';
    this.stopHint();
    actor.state = 'down';
    this.current++;
    for (const player of [1, 2] as const) this.removeTeamMark(actor, player);
    this.time.delayedCall(CONFIG.SPLASH_BEFORE_SPOTLIGHT, () => this.spotlight(actor));
  }

  /**
   * Spotlight: the scene goes dark, the character comes big into the middle with its quote,
   * then it tumbles out of the screen and the game goes on.
   */
  private spotlight(actor: Actor) {
    // The quote sign goes back up.
    const sign = this.quoteSign;
    this.quoteSign = undefined;
    if (sign) {
      this.tweens.killTweensOf(sign);
      this.tweens.add({ targets: sign, y: sign.y - 600, duration: 500, ease: 'Back.In', onComplete: () => sign.destroy() });
    }

    // Everything else goes dark.
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000).setOrigin(0).setDepth(DEPTH.spotDim).setAlpha(0);
    this.tweens.add({ targets: dim, alpha: SPOTLIGHT.dim, duration: 300 });

    // The character comes big into the middle.
    const box = actor.body.getBounds();
    const body = this.detachBody(actor, DEPTH.spotActor);
    const grow = Math.min(SPOTLIGHT.maxWidth / box.width, SPOTLIGHT.maxHeight / box.height);
    this.tweens.add({
      targets: body,
      x: SPOTLIGHT.x,
      y: SPOTLIGHT.y,
      angle: 0,
      scaleX: body.scaleX * grow,
      scaleY: body.scaleY * grow,
      duration: 500,
      ease: 'Back.Out',
    });

    // Its quote, up and to the left.
    const b = SPOTLIGHT.bubble;
    const bubble = this.makeQuoteBubble(actor.def, SPOTLIGHT.x + b.dx, SPOTLIGHT.y + b.dy);
    bubble.setDepth(DEPTH.spotBubble).setAngle(b.angle);
    popIn(this, bubble, { delay: 300 });
    if (this.cache.audio.exists(audioKey(actor.def))) this.sound.play(audioKey(actor.def));

    // Then: the quote goes, the character tumbles out of the screen, the light comes back.
    this.time.delayedCall(CONFIG.REVEAL_TIME, () => {
      this.tweens.add({ targets: bubble, alpha: 0, scale: bubble.scale * 0.8, duration: 300, onComplete: () => bubble.destroy() });
      this.fallOut(body);
      this.tweens.add({ targets: dim, alpha: 0, delay: 300, duration: 400, onComplete: () => dim.destroy() });
    });
    this.time.delayedCall(CONFIG.REVEAL_TIME + CONFIG.NEXT_QUOTE_DELAY, () => this.nextQuote());
  }

  /** Take the body out of its container, at the same place on screen (whole again, not cut off). */
  private detachBody(actor: Actor, depth: number): Body {
    const { body, container } = actor;
    if (body instanceof GameObjects.Image) body.setCrop();
    const box = body.getBounds();
    const angle = container.angle + body.angle;
    const scale = container.scale;
    container.remove(body);
    this.add.existing(body);
    if (body instanceof GameObjects.Image) body.setOrigin(0.5);
    body.setPosition(box.centerX, box.centerY).setAngle(angle).setDepth(depth);
    body.setScale(body.scaleX * scale, body.scaleY * scale);
    return body;
  }

  /** A little hop up, then tumbling down (spinning) until it is out of the screen. */
  private fallOut(body: Body) {
    if (!this.sys.isActive()) return;
    const side = Math.random() < 0.5 ? -1 : 1;
    this.tweens.add({ targets: body, y: body.y - 60, duration: 200, ease: 'Quad.Out' });
    this.tweens.add({ targets: body, x: body.x + side * 260, angle: body.angle + side * 200, duration: 900, ease: 'Sine.In' });
    this.tweens.add({
      targets: body,
      y: GAME_HEIGHT + Math.max(body.displayHeight, 400),
      delay: 200,
      duration: 750,
      ease: 'Quad.In',
      onComplete: () => body.destroy(),
    });
  }

  // ---------------------------------------------------------------------------
  // Ending
  // ---------------------------------------------------------------------------

  private showEnding() {
    this.state = 'ending';
    this.stopHint();
    // No more throwing: the waiting balloons go down.
    for (const player of [1, 2] as const) {
      const balloon = this.waiting[player];
      this.waiting[player] = undefined;
      if (balloon) sinkOut(this, balloon, { distance: 400, onComplete: () => balloon.destroy() });
    }

    this.time.delayedCall(800, () => this.fireCannon());
  }

  /** Where things come out of the cannon (at its resting place). */
  private muzzle() {
    // canon.svg is 533 x 508.
    const height = this.cannon?.displayHeight ?? (CANNON.width * 508) / 533;
    return {
      x: CANNON.x + (CANNON.muzzle.x - 0.5) * CANNON.width,
      y: CANNON.y + (CANNON.muzzle.y - 0.5) * height,
    };
  }

  /** The cannon fires: recoil, and a puff of smoke at the muzzle. */
  private cannonPuff() {
    const cannon = this.cannon;
    if (!cannon) return;
    this.tweens.add({ targets: cannon, x: { from: CANNON.x - 30, to: CANNON.x }, angle: { from: -6, to: 0 }, duration: 350, ease: 'Quad.Out' });
    const muzzle = this.muzzle();
    const smoke = this.add.image(muzzle.x + 40, muzzle.y - 30, 'km-smoke').setDepth(DEPTH.effects);
    const smokeScale = 260 / smoke.width;
    smoke.setScale(smokeScale * 0.3);
    this.tweens.add({ targets: smoke, scale: smokeScale, duration: 250, ease: 'Back.Out' });
    this.tweens.add({ targets: smoke, alpha: 0, y: smoke.y - 80, delay: 500, duration: 700, onComplete: () => smoke.destroy() });
  }

  private fireCannon() {
    if (!this.cannon || !this.sys.isActive()) return;
    this.cannonPuff();
    const muzzle = this.muzzle();

    // The book flies out in an arc and lands in the middle.
    const book = this.add.image(muzzle.x, muzzle.y, 'km-book').setDepth(DEPTH.book);
    const flyScale = BOOK.flyWidth / book.width;
    book.setScale(flyScale);
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 1000,
      onUpdate: (tween) => {
        const t = tween.getValue() ?? 0;
        book.setPosition(PMath.Linear(muzzle.x, BOOK.x, t), PMath.Linear(muzzle.y, BOOK.y, t) - 520 * 4 * t * (1 - t));
        book.setAngle(720 * t);
      },
      onComplete: () => this.openBook(book),
    });
  }

  /** The book grows, then opens (squash shut, swap to the open book, unfold). */
  private openBook(book: GameObjects.Image) {
    const overlay = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000).setOrigin(0).setDepth(DEPTH.overlay).setAlpha(0);
    this.tweens.add({ targets: overlay, alpha: 0.45, duration: 500 });

    const closedScale = BOOK.closedWidth / book.width;
    this.tweens.add({
      targets: book,
      scale: closedScale,
      angle: 0,
      duration: 600,
      ease: 'Back.Out',
      completeDelay: 250,
      onComplete: () => {
        // Close up sideways...
        this.tweens.add({
          targets: book,
          scaleX: 0,
          duration: 180,
          ease: 'Quad.In',
          onComplete: () => {
            // ...and unfold as the open book.
            book.setTexture('km-book-open');
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
    // The hands come back (to click the back button).
    this.pointers.show();
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------


  /** Player 1's balloon: ballon.svg, recoloured blue. Textures stay between scene visits, so this runs once. */
  private makeBlueBalloon(): Promise<void> {
    const source = this.cache.text.get('km-balloon-svg') as string | undefined;
    if (!source) return Promise.resolve();
    const svg = source
      .replace(/#D23636/gi, '#2F6FC0')
      .replace(/#E95656/gi, '#6FA8E8')
      // Twice the size, like the other SVGs (RENDER_SCALE).
      .replace('width="259" height="281"', 'width="518" height="562"');
    return this.svgTexture('km-balloon-blue', svg);
  }

  /**
   * The podium: opstapding.svg stops at y = 255 while its white edge and shadow go on to 280,
   * so the bottom was cut off. Make the picture 285 high (and twice the size, like the other SVGs).
   */
  private makePodium(): Promise<void> {
    const source = this.cache.text.get('km-podium-svg') as string | undefined;
    if (!source) return Promise.resolve();
    const svg = source.replace(
      'width="627" height="255" viewBox="0 0 627 255"',
      `width="${627 * RENDER_SCALE}" height="${PODIUM_SVG.height * RENDER_SCALE}" viewBox="0 0 627 ${PODIUM_SVG.height}"`,
    );
    return this.svgTexture('km-podium', svg);
  }

  /** Turn SVG text into a texture. Textures stay between scene visits, so this is done once. */
  private svgTexture(key: string, svg: string): Promise<void> {
    if (this.textures.exists(key)) return Promise.resolve();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const image = new Image();
    return new Promise((resolve) => {
      image.onload = () => {
        if (!this.textures.exists(key)) this.textures.addImage(key, image);
        URL.revokeObjectURL(url);
        resolve();
      };
      // Without it, a fallback is used (e.g. the red balloon instead of the blue one).
      image.onerror = () => resolve();
      image.src = url;
    });
  }
}

const charKey = (def: ComedyCharacter) => `km-char-${def.id}`;
const signKey = (def: ComedyCharacter) => `km-sign-${def.id}`;
const quoteKey = (def: ComedyCharacter) => `km-quote-${def.id}`;
const audioKey = (def: ComedyCharacter) => `km-audio-${def.id}`;

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
