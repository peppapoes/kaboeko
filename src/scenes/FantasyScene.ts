import { GameObjects, Input, Math as PMath, Scene, type Time, type Tweens, type Types } from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE, setupCamera } from '../config';
import { inputManager } from '../input/InputManager';
import { dropIn, popIn, riseIn, setRestAngle, sinkOut, slideIn } from '../puppet';
import { PlayerPointers } from '../playerPointers';
import { placeShape, PRACTICE_SHAPE, resample, SPELLS, SpellTrace, type Point, type SpellDef } from './fantasySpells';

/*
 * Minigame "fantasie". Works the same way as the geschiedenis game.
 *
 * Flow:
 *  0. Title: "FANTASIE" with the letters falling in one by one, then the
 *     umbrella and the wand come in and move a little. Goes on with a button
 *     press, or by itself after a few seconds.
 *  1. Intro: the letters go, the umbrella and wand move to their spot next to
 *     the cards. Two small cards (what each player does) and the big wooden
 *     sign (the goal of the game) come up. The players' hands are the cursor.
 *  2. Mini tutorial: the umbrella and wand become the players' cursors.
 *     - player 1 (controller, left, blue) opens the umbrella (controller button
 *       or Space) on a blue circle below their card;
 *     - player 2 (mouse, right, red) follows a short dotted line below theirs.
 *     When both did it, the cards go, "Hou je klaar!" and 3, 2, 1, and the game starts.
 *  3. The game: the witch throws attacks (player 1 bounces them back with the
 *     umbrella), player 2 casts spells at her. At zero health she goes up in
 *     smoke and the book appears.
 */

const PATH = 'assets/minigame-fantasie/';

// ---------------------------------------------------------------------------
// Layout (game coordinates) — tweak to move things around
// ---------------------------------------------------------------------------

/** Title letters (Oswald). x/y = center of the word; gap = space between two letters. */
const TITLE = { text: 'FANTASIE', x: GAME_WIDTH / 2, y: 640, fontSize: 290, gap: 14 };
/** Every letter is a bit tilted and moved up/down, like the geschiedenis title (degrees, game px). */
const TITLE_LETTER_ANGLES = [-4, 3, -2, 4, -3, 2, -4, 3];
const TITLE_LETTER_OFFSETS = [6, -10, 12, -4, 10, -12, 4, -8];
/** Time between two letters falling in. */
const TITLE_LETTER_DELAY = 70;
/** The title goes on by itself after this many ms (a button press goes on sooner). */
const TITLE_TIME = 4500;

/**
 * Where the wand and umbrella are on the title screen and in the intro.
 * height = how tall they are on screen (game pixels), whatever the size of the image file.
 */
const PROP_SPOTS = {
  title: {
    umbrella: { x: 540, y: 340, height: 250, angle: -20 },
    wand: { x: 1400, y: 860, height: 300, angle: 25 },
  },
  // Each prop on the inner corner of its player's card: umbrella (player 1) left, wand (player 2) right.
  intro: {
    umbrella: { x: 640, y: 600, height: 210, angle: -15 },
    wand: { x: 1245, y: 600, height: 260, angle: 20 },
  },
};

/** How far (degrees) the cards lean towards the outside of the screen. */
const CARD_LEAN = 5;
/**
 * After the tutorial: "Hou je klaar!", then 3, 2, 1 in the middle of the screen,
 * then "Start!" and the game starts by itself. Times in ms.
 */
const COUNTDOWN = { text: 'Hou je klaar!', numbers: ['3', '2', '1'], go: 'Start!', y: 600, readyTime: 1300, numberTime: 850 };
/**
 * The mini tutorial, below the cards: player 1 opens the umbrella on the blue
 * circle, player 2 follows the short dotted line (size = its width).
 * `waitText` is shown where the start button comes, until both are done.
 */
const PRACTICE = {
  circle: { x: 640, y: 1050 },
  line: { x: 1240, y: 1040, size: 320 },
  waitText: { text: 'Probeer het eerst allebei even!', y: 1200 },
  /** After both are done, this long (ms) before the cards go and the countdown starts. */
  doneDelay: 700,
};
/** The intro cards stand a bit higher than the end of their stick, like in geschiedenis. */
const INTRO_CARD_BOTTOM_Y = GAME_HEIGHT + 30;

/**
 * The two player cards. The card images are the geschiedenis cards without
 * their text (so they look the same); the text is added here.
 * - lean: how much the drawing itself already leans, in degrees (+ = to the right).
 * - angle: how much the white card in the drawing is turned (the text turns with it).
 * - lines: positions in pixels of the SVG file.
 */
const CARDS = {
  p1: {
    key: 'fantasy-card-p1',
    file: 'speler1-stap1.svg',
    svgWidth: 598,
    svgHeight: 864,
    x: 395,
    scale: 0.885,
    lean: -5,
    angle: -4,
    color: '#2B69B4',
    role: { text: 'Jij beschermt!', x: 277, y: 177 },
    /** Small drawing between the title and the explanation (see drawCardIcon). */
    icon: { kind: 'target' as CardIcon, x: 281, y: 236 },
    hint: { text: 'Hou je paraplu open\nop de blauwe cirkel', x: 286, y: 280 },
  },
  p2: {
    key: 'fantasy-card-p2',
    file: 'speler2-stap1.svg',
    svgWidth: 593,
    svgHeight: 877,
    x: 1525,
    scale: 0.885,
    lean: 5,
    angle: 6.4,
    color: '#D23636',
    role: { text: 'Jij tovert!', x: 298, y: 188 },
    icon: { kind: 'spell' as CardIcon, x: 292, y: 243 },
    hint: { text: 'Doe de spreuk na\nmet je toverstaf', x: 286, y: 289 },
  },
};

/**
 * The big wooden sign with the goal of the game (the geschiedenis sign without its text).
 * It hangs at the top of the screen: the image is turned upside down, so its post
 * goes up, out of the screen. topY = where the end of the post is (above the screen).
 * Text positions are in pixels of the upside-down SVG (y = 0 is the end of the post).
 */
const SIGN = {
  key: 'fantasy-sign',
  file: 'sign.svg',
  svgWidth: 1138,
  scale: 0.8,
  topY: -100,
  title: { text: 'Versla de heks!', x: 564, y: 358 },
  /** y = top of the text (it can be two lines). */
  text: { text: 'Toveren en beschermen: samen zijn jullie sterker dan de heks!', x: 564, y: 400 },
  /** Text wider than this (SVG pixels) goes on the next line. */
  textWidth: 860,
};
/** The rounded font of the wooden signs (see index.html). */
const SIGN_FONT = 'Andika';

/**
 * The end: the book that comes out of the "poef" cloud. The same book as at
 * the end of geschiedenis (the last thing you dig up there), closed and open.
 */
const BOOK = {
  closedKey: 'fantasy-book',
  closedFile: 'assets/minigame-geschiedenis/book.png',
  /** Height of the closed book on screen. */
  closedHeight: 420,
  openKey: 'fantasy-book-open',
  openFile: 'assets/minigame-geschiedenis/book-1.png',
  /** The book opens by itself this long (ms) after it appeared (when the clouds are gone). */
  openDelay: 2200,
};
/**
 * The witch's disappearing act (ms): how long she holds her face, and how long
 * the cartoon "poef" cloud stays before it dissolves (and shows the book behind it).
 */
const WITCH_END = { holdTime: 1300, cloudTime: 1300 };
/**
 * The "poef" cloud: little clouds around the witch's middle (x/y offset in game
 * pixels, size = width on screen). Together they cover the whole witch.
 */
const POOF_CLOUDS = [
  { x: 0, y: 60, size: 520 },
  { x: -170, y: -110, size: 380 },
  { x: 170, y: -90, size: 400 },
  { x: 0, y: -280, size: 400 },
  { x: -150, y: 250, size: 360 },
  { x: 150, y: 270, size: 360 },
  { x: 10, y: -440, size: 300 },
];

// ---------------------------------------------------------------------------
// The game — tweak these to make it easier/harder or to move things around
// ---------------------------------------------------------------------------


/** The witch: where her feet are, her size, and how much she can take. */
const WITCH = { x: 960, bottomY: 960, scale: 0.68, health: 100 };
/** Her poses (all drawn at the same scale, so they can be swapped). */
const WITCH_POSES = {
  idle: 'fantasy-witch-down',
  windUp: 'fantasy-witch-one-arm',
  attack: 'fantasy-witch-attack',
  hit: 'fantasy-witch-hit',
};
/** How long (ms) a pose stays before she stands normally again. */
const WITCH_POSE_TIME = { attack: 700, hit: 800 };
/** How much health the witch loses per hit. */
const DAMAGE = { bounce: 10, spell: 12 };
/** How much health the witch gets back when an attack is not caught with the umbrella. */
const HEAL_ON_MISS = 8;

/**
 * The witch's health bar, with a heart in front, right above her head.
 * x = left end of the bar (the heart sits on it).
 */
const HEALTH_BAR = { x: 960 - 230 + 20, y: 165, width: 460, height: 28, border: 5, heartSize: 76 };

/** The props the players hold while playing. Sizes in game pixels. */
const PLAYER_PROPS = {
  umbrella: { startX: 300, startY: 1000, openWidth: 250, closedHeight: 190, badgeY: 175 },
  wand: { startX: 1300, startY: 1050, height: 200, badgeX: 70, badgeY: 225 },
};
const BADGE = { width: 150, height: 48 };

/** The witch's attacks. */
const ATTACK = {
  /** First attack this many ms after the game starts; then a pause between minPause and maxPause. */
  firstDelay: 3500,
  minPause: 2500,
  maxPause: 4500,
  /** How long an attack takes to reach the players (ms): longer = easier. */
  flyTime: 3200,
  /** Where attacks can land (the floor in front of the witch). */
  targetArea: { x: 200, y: 860, width: 1520, height: 260 },
  /**
   * When the attack arrives, the open umbrella has to be on the circle: at most
   * this far (px) from its middle. Only then it bounces back (not earlier in the air).
   */
  blockRadius: 150,
  /** After bouncing an attack back, the umbrella closes by itself after this many ms. */
  closeAfterBounce: 600,
  monkeySize: 230,
  potionSize: 140,
};

/** Where the movement for a spell is shown: the wand has to follow its dots. */
const SPELL_AREA = {
  /** Middle of the movement on screen, and its size (game pixels). */
  x: 1520,
  y: 600,
  size: 360,
  /** The dark circle behind the movement, as a part of `size`. */
  backdrop: 0.72,
};
const SPELL = {
  /** First spell this many ms after the game starts; the next one this long after casting. */
  firstDelay: 1500,
  nextDelay: 1200,
  /** Distance between the dots of the movement. */
  dotSpacing: 42,
  /** How close (px) the tip of the wand has to come to a dot: bigger = easier. */
  hitRadius: 75,
};
/** The players' colours: player 1 (umbrella) blue, player 2 (wand, spells) red. */
const PLAYER_COLOR = { p1: 0x2b69b4, p2: 0xd23636 };
/** The spell movement (start dot, the part already done) is in player 2's colour. */
const SPELL_COLOR = PLAYER_COLOR.p2;
/**
 * Above the spell's movement, a quote card (like in geschiedenis) shows the
 * spell's words and where they come from. The card is the geschiedenis quote
 * without its text (quote.svg); the text is added here. Positions in SVG pixels.
 */
const QUOTE = {
  key: 'fantasy-quote',
  file: 'quote.svg',
  svgWidth: 782,
  svgHeight: 358,
  /** Width on screen. */
  width: 540,
  /** Left/right of the middle of the movement, and how far it overlaps the dark circle (px). */
  x: -20,
  overlap: 55,
  /** The paper in the drawing is turned this much (degrees): the text turns with it. */
  angle: -7.3,
  text: { x: 392, y: 175 },
};
/** Expecto Patronum: the deer (size = width on screen, alpha = how see-through, runTime = ms to reach the witch). */
const PATRONUS = { size: 260, alpha: 0.85, runTime: 1100 };

/** Images that are drawn in code (see makeTextures). */
const SPARK_KEY = 'fantasy-spark';
const HEART_KEY = 'fantasy-heart';
const PATRONUS_KEY = 'fantasy-hert';
/**
 * Anaklusmos (Percy Jackson): the pen is thrown, spinning, and halfway
 * (`changeAt`, 0..1 of the flight) it turns into the sword. Sizes = height on screen.
 */
const PEN_SWORD = {
  penKey: 'fantasy-pen',
  swordKey: 'fantasy-sword',
  penSize: 130,
  swordSize: 260,
  flyTime: 1000,
  /** How high the throw goes (px above the straight line). */
  arc: 240,
  /** Turns per throw. */
  spins: 3,
  changeAt: 0.45,
};
const ICON_KEYS = { target: 'fantasy-icon-target', spell: 'fantasy-icon-spell' };
/** Size of the line drawings on the player cards (1 = as drawn). */
const CARD_ICON_SIZE = 0.85;
const CLOUD_KEY = 'fantasy-cloud';

/** Draw order (higher = on top). */
const DEPTH = {
  background: 0,
  marker: 3,
  witch: 4,
  projectile: 5,
  spell: 6,
  hud: 8,
  smoke: 11,
  backButton: 14,
  card: 15,
  /** The tutorial's circle and line (below the cards, above the floor). */
  practice: 15.5,
  /** The umbrella and wand: above the cards, because they are already used in the intro. */
  players: 16,
  introProp: 16,
  book: 18,
};

type State = 'title' | 'titleReady' | 'intro' | 'tutorial' | 'busy' | 'playing' | 'done';
type AttackKind = 'monkey' | 'potion';
/** Small drawings on the player cards: the red landing circle, or a spell movement to copy. */
type CardIcon = 'target' | 'spell';

/** An attack of the witch that is on its way. */
interface Attack {
  kind: AttackKind;
  sprite: GameObjects.Image;
  marker: GameObjects.Graphics;
  tween?: Tweens.Tween;
}

/** The mini tutorial in the intro: what each player has to try once. */
interface Practice {
  circle: GameObjects.Graphics;
  trace: SpellTrace;
  local: Point[];
  traced: GameObjects.Graphics;
  start: GameObjects.Arc;
  line: GameObjects.Container;
  waitText: GameObjects.Text;
  p1Done: boolean;
  p2Done: boolean;
}

/** The spell the wizard is tracing now. */
interface ActiveSpell {
  def: SpellDef;
  trace: SpellTrace;
  view: GameObjects.Container;
  traced: GameObjects.Graphics;
  start: GameObjects.Arc;
  /** Shown over the movement while the umbrella is open (then no spell can be cast). */
  lock: GameObjects.Text;
  /** The dots, relative to the middle of the spell area. */
  local: { x: number; y: number }[];
}

export class FantasyScene extends Scene {
  private state: State = 'title';
  private titleLetters: GameObjects.Container[] = [];
  /** Wand and umbrella shown on the title and intro screens. */
  private introWand?: GameObjects.Image;
  private introUmbrella?: GameObjects.Image;
  /** Cards and sign of the intro. */
  private introObjects: GameObjects.Container[] = [];
  private practice?: Practice;
  /** The players' hands, on the title and intro (while playing, the wand and umbrella are the cursor). */
  private pointers!: PlayerPointers;
  private backButton?: GameObjects.Image;
  /** The end: the closed book (opened with a button press). */
  private closedBook?: GameObjects.Image;
  private closedBookScale = 1;
  private bookSparkles?: Time.TimerEvent;

  private umbrellaClosed!: GameObjects.Image;
  private umbrellaOpen!: GameObjects.Image;
  private umbrellaBadge!: GameObjects.Container;
  private wand!: GameObjects.Image;
  private wandBadge!: GameObjects.Container;
  private isUmbrellaOpen = false;
  /** Where the umbrella and the tip of the wand are. */
  private umbrellaAt = { x: 0, y: 0 };
  private wandAt = { x: 0, y: 0 };

  private witch!: GameObjects.Image;
  private witchHealth = WITCH.health;
  /** Counts pose changes, so an old "back to standing" timer doesn't undo a newer pose. */
  private poseId = 0;
  private healthBar!: GameObjects.Container;
  private healthFill!: GameObjects.Graphics;
  /** The fraction of the bar that is shown (slides to the real value). */
  private healthShown = 1;
  private healthTween?: Tweens.Tween;
  private attack?: Attack;
  private spell?: ActiveSpell;
  private lastSpell?: SpellDef;

  constructor() {
    super('FantasyScene');
  }

  preload() {
    const svg = (key: string, file: string) => this.load.svg(key, PATH + file, { scale: RENDER_SCALE });

    // The empty room, for the title and the explanation.
    this.load.image('fantasy-background-intro', PATH + 'fantasyBackground.png');
    // The room while playing (with the shelves, torch and cauldron), as big as the canvas so it stays sharp.
    this.load.svg('fantasy-background', PATH + 'background.svg', {
      width: GAME_WIDTH * RENDER_SCALE,
      height: GAME_HEIGHT * RENDER_SCALE,
    });
    svg(WITCH_POSES.idle, 'theWitch-poseDown.svg');
    svg(WITCH_POSES.windUp, 'theWitch-poseOneArm.svg');
    svg(WITCH_POSES.attack, 'theWitch-attack.svg');
    svg(WITCH_POSES.hit, 'theWitch-afterAttacked.svg');
    svg('fantasy-monkey', 'monkey.svg');
    svg('fantasy-potion', 'potion1.svg');
    svg('fantasy-wand', 'wand.svg');
    svg('fantasy-umbrella-open', 'umbrellaOpen.svg');
    svg('fantasy-umbrella-closed', 'umbrella-closed.svg');
    svg(SIGN.key, SIGN.file);
    svg(QUOTE.key, QUOTE.file);
    svg(PATRONUS_KEY, 'hert.svg');
    svg(PEN_SWORD.penKey, 'pen.svg');
    svg(PEN_SWORD.swordKey, 'sword.svg');
    this.load.image(BOOK.closedKey, BOOK.closedFile);
    this.load.image(BOOK.openKey, BOOK.openFile);
    Object.values(CARDS).forEach((card) => svg(card.key, card.file));
    // Shared with the geschiedenis game.
    this.load.image('fantasy-back', 'assets/minigame-geschiedenis/back-button.png');
    PlayerPointers.preload(this);
  }

  create() {
    setupCamera(this);
    // Dark blue behind the background (the same colour as its walls).
    this.cameras.main.setBackgroundColor('#03314E');
    // Fade in from black (the menu fades out to black).
    this.cameras.main.fadeIn(600, 0, 0, 0);
    // Input is switched off while leaving the scene; switch it back on.
    this.input.enabled = true;
    // Controller in 'point' mode: "point at the star" first, to set the center.
    inputManager.startRecenter(this);

    // Reset state: the same scene object is reused when the scene restarts.
    this.state = 'title';
    this.titleLetters = [];
    this.introWand = undefined;
    this.introUmbrella = undefined;
    this.introObjects = [];
    this.practice = undefined;
    this.isUmbrellaOpen = false;
    this.witchHealth = WITCH.health;
    this.poseId = 0;
    this.attack = undefined;
    this.spell = undefined;
    this.lastSpell = undefined;
    this.closedBook = undefined;
    this.bookSparkles = undefined;
    this.makeTextures();

    // The empty room first; the full room fades in when the game starts (see startGame).
    this.add
      .image(0, 0, 'fantasy-background-intro')
      .setOrigin(0)
      .setDisplaySize(GAME_WIDTH, GAME_HEIGHT)
      .setDepth(DEPTH.background);

    // Two players: player 1 on the controller, player 2 on the mouse.
    inputManager.setSplit(this);
    // Hands as the cursor until the game starts (then the wand and umbrella take over).
    this.pointers = new PlayerPointers(this);
    this.pointers.show();

    this.addBackButton();

    this.input.on('pointerup', this.pressButton, this);
    inputManager.on('select', this.onPlayer1Button, this);
    this.events.once('shutdown', () => {
      this.input.off('pointerup', this.pressButton, this);
      inputManager.off('select', this.onPlayer1Button, this);
      this.removeGameplayInput();
    });

    void this.showTitle();
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  /** "The button": a mouse click, or player 1's controller button / Space. */
  private pressButton() {
    if (this.state === 'titleReady') this.leaveTitle();
  }

  /** Player 1's button (controller button or Space): opens/closes the umbrella while playing. */
  private onPlayer1Button({ player }: { player?: number }) {
    if (player !== 1) return;
    if (this.state === 'playing' || this.state === 'tutorial') this.toggleUmbrella();
    else this.pressButton();
  }

  private addBackButton() {
    const button = this.add
      .image(110, 84, 'fantasy-back')
      .setScale(95 / 335)
      .setDepth(DEPTH.backButton)
      .setInteractive()
      .on('pointerup', (_pointer: Input.Pointer, _x: number, _y: number, event: Types.Input.EventData) => {
        // Don't let this click also count as "the button".
        event.stopPropagation();
        // Fade to black, then back to the genre choice in the menu (without the title screen).
        this.input.enabled = false;
        this.cameras.main.fadeOut(400, 0, 0, 0);
        this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('MenuScene', { skipTitle: true }));
      });
    popIn(this, button, { delay: 300 });
    this.backButton = button;
  }

  // ---------------------------------------------------------------------------
  // Title
  // ---------------------------------------------------------------------------

  private async showTitle() {
    // Also the sign's font now, so it is ready when the intro comes.
    await Promise.all([
      document.fonts.load(`700 ${TITLE.fontSize}px Oswald`),
      document.fonts.load(`700 40px ${SIGN_FONT}`),
      document.fonts.load(`400 24px ${SIGN_FONT}`),
    ]);
    // The player may have left the scene while the font was loading.
    if (!this.sys.isActive() || this.state !== 'title') return;

    // Make the letters first, to know how wide the word is.
    const texts = Array.from(TITLE.text).map((character) =>
      this.add
        .text(0, 0, character, {
          fontFamily: 'Oswald',
          fontSize: `${TITLE.fontSize}px`,
          fontStyle: '700',
          color: '#ffffff',
          resolution: RENDER_SCALE,
        })
        .setOrigin(0.5),
    );
    const totalWidth = texts.reduce((sum, text) => sum + text.width, 0) + TITLE.gap * (texts.length - 1);

    // Each letter in its own container, so it can be moved like a puppet.
    // Letters fall in one by one, like puppets on a string.
    let x = TITLE.x - totalWidth / 2;
    const letters = texts.map((text, i) => {
      const letter = this.add
        .container(x + text.width / 2, TITLE.y + TITLE_LETTER_OFFSETS[i % TITLE_LETTER_OFFSETS.length], [text])
        .setDepth(DEPTH.card);
      x += text.width + TITLE.gap;
      setRestAngle(letter, TITLE_LETTER_ANGLES[i % TITLE_LETTER_ANGLES.length]);
      dropIn(this, letter, { delay: 200 + i * TITLE_LETTER_DELAY, distance: 900 });
      return letter;
    });
    this.titleLetters = letters;

    // Then the wand and umbrella come in and show what they do. They stay for the intro.
    const propsDelay = 400 + letters.length * TITLE_LETTER_DELAY;
    const { wand: w, umbrella: u } = PROP_SPOTS.title;
    this.introUmbrella = this.add.image(u.x, u.y, 'fantasy-umbrella-open').setDepth(DEPTH.introProp).setAngle(u.angle);
    this.introUmbrella.setScale(u.height / this.introUmbrella.height);
    this.introWand = this.add.image(w.x, w.y, 'fantasy-wand').setDepth(DEPTH.introProp).setAngle(w.angle);
    this.introWand.setScale(w.height / this.introWand.height);
    const umbrella = this.introUmbrella;
    const wand = this.introWand;
    slideIn(this, umbrella, 'left', { delay: propsDelay, sway: false, onComplete: () => this.shielding(umbrella) });
    slideIn(this, wand, 'right', { delay: propsDelay + 150, sway: false, onComplete: () => this.casting(wand) });

    this.time.delayedCall(propsDelay + 600, () => {
      if (this.state === 'title') this.state = 'titleReady';
    });
    this.time.delayedCall(TITLE_TIME, () => {
      if (this.state === 'titleReady') this.leaveTitle();
    });
  }

  private leaveTitle() {
    this.state = 'busy';

    const letters = this.titleLetters;
    this.titleLetters = [];
    letters.forEach((letter, i) => sinkOut(this, letter, { delay: i * 30 }));

    // The wand and umbrella don't leave: they move on to their place in the intro.
    this.moveProp(this.introWand, PROP_SPOTS.intro.wand, (wand) => this.casting(wand));
    this.moveProp(this.introUmbrella, PROP_SPOTS.intro.umbrella, (umbrella) => this.shielding(umbrella));

    this.time.delayedCall(900, () => {
      letters.forEach((letter) => letter.destroy());
      this.showIntro();
    });
  }

  /** Glide a prop to a new spot, then start its movement again. */
  private moveProp(
    prop: GameObjects.Image | undefined,
    spot: { x: number; y: number; height: number; angle: number },
    then: (prop: GameObjects.Image) => void,
  ) {
    if (!prop) return;
    this.tweens.killTweensOf(prop);
    this.tweens.add({
      targets: prop,
      x: spot.x,
      y: spot.y,
      scale: spot.height / prop.height,
      angle: spot.angle,
      duration: 900,
      ease: 'Back.InOut',
      onComplete: () => then(prop),
    });
  }

  /** The wand casts a spell: a quick flick, then a short rest. */
  private casting(wand: GameObjects.Image) {
    this.tweens.add({
      targets: wand,
      angle: wand.angle + 22,
      y: wand.y - 20,
      duration: 260,
      yoyo: true,
      repeat: -1,
      repeatDelay: 350,
      ease: 'Sine.InOut',
    });
  }

  /** The umbrella bobs up and down and tilts a little, as if it catches something. */
  private shielding(umbrella: GameObjects.Image) {
    this.tweens.add({
      targets: umbrella,
      y: umbrella.y - 22,
      angle: umbrella.angle - 10,
      duration: 500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    });
  }

  // ---------------------------------------------------------------------------
  // Intro
  // ---------------------------------------------------------------------------

  private showIntro() {
    this.state = 'intro';

    const sign = this.makeSign();
    const cardP2 = this.makeCard(CARDS.p2);
    const cardP1 = this.makeCard(CARDS.p1);

    // The sign comes down from the top and then hangs still; the cards keep swaying.
    dropIn(this, sign, { delay: 100, distance: 500, sway: false });
    riseIn(this, cardP2, { delay: 400 });
    riseIn(this, cardP1, { delay: 550 });
    this.introObjects = [sign, cardP2, cardP1];

    // When the cards are up: the mini tutorial (the start button comes after it).
    this.time.delayedCall(1400, () => {
      if (this.state === 'intro') this.startTutorial();
    });
  }

  // ---------------------------------------------------------------------------
  // Mini tutorial
  // ---------------------------------------------------------------------------

  /**
   * The umbrella and wand next to the cards become the players' cursors, and
   * each player tries their job once: player 1 opens the umbrella on the blue
   * circle, player 2 follows a short dotted line.
   */
  private startTutorial() {
    this.state = 'tutorial';

    // The props from the title take over from the hands, right where they are.
    const umbrella = this.introUmbrella;
    const wand = this.introWand;
    this.introUmbrella = undefined;
    this.introWand = undefined;
    this.createPlayers(
      { x: umbrella?.x ?? PROP_SPOTS.intro.umbrella.x, y: umbrella?.y ?? PROP_SPOTS.intro.umbrella.y },
      { x: wand?.x ?? PROP_SPOTS.intro.wand.x, y: wand?.y ?? PROP_SPOTS.intro.wand.y },
    );
    for (const prop of [umbrella, wand]) {
      if (!prop) continue;
      this.tweens.killTweensOf(prop);
      prop.destroy();
    }

    // Player 1: the blue circle, like where the witch's attacks land.
    const circle = this.drawLandingCircle(PRACTICE.circle.x, PRACTICE.circle.y).setDepth(DEPTH.practice).setAlpha(0);
    this.tweens.add({ targets: circle, alpha: 1, duration: 300, delay: 200 });

    // Player 2: a short movement to follow, drawn like the spells.
    const { x, y, size } = PRACTICE.line;
    const local = resample(placeShape(PRACTICE_SHAPE, 0, 0, size), SPELL.dotSpacing);
    const { dots, traced, start } = this.drawSpellDots(local);
    const line = this.add.container(x, y, [dots, traced, start]).setDepth(DEPTH.practice);
    popIn(this, line, { delay: 350 });
    const trace = new SpellTrace(
      local.map((d) => ({ x: d.x + x, y: d.y + y })),
      SPELL.hitRadius,
    );

    // Where the start button will come: "try it first".
    const waitText = this.add
      .text(GAME_WIDTH / 2, PRACTICE.waitText.y, PRACTICE.waitText.text, {
        fontFamily: SIGN_FONT,
        fontStyle: '700',
        fontSize: '36px',
        color: '#FFFFFF',
        resolution: RENDER_SCALE,
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.practice)
      .setAlpha(0);
    this.tweens.add({ targets: waitText, alpha: 1, duration: 400, delay: 500 });

    this.practice = { circle, trace, local, traced, start, line, waitText, p1Done: false, p2Done: false };
  }

  /** Player 1 in the tutorial: is the open umbrella on the circle? */
  private checkPracticeUmbrella() {
    const practice = this.practice;
    if (this.state !== 'tutorial' || !practice || practice.p1Done || !this.isUmbrellaOpen) return;
    const { x, y } = PRACTICE.circle;
    if (PMath.Distance.Between(x, y, this.umbrellaAt.x, this.umbrellaAt.y) >= ATTACK.blockRadius) return;

    practice.p1Done = true;
    this.tweens.killTweensOf(practice.circle);
    practice.circle.setScale(1);
    this.burst(x, y);
    this.addCheck(x, y, PLAYER_COLOR.p1);
    // Like in the game: the umbrella closes by itself.
    this.tweens.add({ targets: this.umbrellaOpen, angle: { from: -12, to: 0 }, duration: 500, ease: 'Elastic.Out' });
    this.time.delayedCall(ATTACK.closeAfterBounce, () => {
      if (this.isUmbrellaOpen) this.toggleUmbrella();
    });
    this.checkPracticeDone();
  }

  /** Player 2 in the tutorial: the wand moved, does it follow the line? */
  private tracePractice(from: Point, to: Point) {
    const practice = this.practice;
    if (this.state !== 'tutorial' || !practice || practice.p2Done || !practice.trace.feed(from, to)) return;
    this.drawTraced(practice.traced, practice.start, practice.local, practice.trace.reached);
    if (!practice.trace.done) return;

    practice.p2Done = true;
    const end = practice.local[practice.local.length - 1];
    const x = PRACTICE.line.x + end.x;
    const y = PRACTICE.line.y + end.y;
    this.burst(x, y);
    this.addCheck(x, y, PLAYER_COLOR.p2);
    this.checkPracticeDone();
  }

  /** Both tried it: after a moment the intro goes and the countdown starts. */
  private checkPracticeDone() {
    const practice = this.practice;
    if (!practice || !practice.p1Done || !practice.p2Done) return;

    this.time.delayedCall(PRACTICE.doneDelay, () => {
      if (this.state === 'tutorial') this.startGame();
    });
  }

  private removePractice() {
    const practice = this.practice;
    this.practice = undefined;
    if (!practice) return;
    for (const object of [practice.circle, practice.line, practice.waitText]) {
      this.tweens.killTweensOf(object);
      this.tweens.add({ targets: object, alpha: 0, duration: 300, onComplete: () => object.destroy() });
    }
  }

  /** A check mark in a white circle: this player did their part. It goes with the tutorial. */
  private addCheck(x: number, y: number, color: number) {
    const mark = this.add
      .graphics()
      .fillStyle(0xffffff, 1)
      .fillCircle(0, 0, 40)
      .lineStyle(6, color, 1)
      .strokeCircle(0, 0, 40)
      .lineStyle(10, color, 1)
      .beginPath()
      .moveTo(-18, 2)
      .lineTo(-5, 16)
      .lineTo(20, -14)
      .strokePath();
    const check = this.add.container(x, y - 70, [mark]).setDepth(DEPTH.practice);
    popIn(this, check);
    // Removed together with the rest of the tutorial.
    const practice = this.practice;
    if (practice) practice.line.once('destroy', () => check.destroy());
    this.time.delayedCall(PRACTICE.doneDelay + 1200, () => {
      if (!check.active) return;
      this.tweens.add({ targets: check, alpha: 0, duration: 300, onComplete: () => check.destroy() });
    });
  }

  /** A player card: the card image with the text on it, standing on its stick. */
  private makeCard(card: (typeof CARDS)[keyof typeof CARDS]): GameObjects.Container {
    const image = this.add.image(0, 0, card.key).setOrigin(0.5, 1).setScale(card.scale / RENDER_SCALE);
    // SVG pixels -> position in the container (whose origin is the bottom of the stick).
    const at = (p: { x: number; y: number }) => ({
      x: (p.x - card.svgWidth / 2) * card.scale,
      y: (p.y - card.svgHeight) * card.scale,
    });

    // Same font as the geschiedenis cards (Andika).
    const role = at(card.role);
    const roleText = this.add
      .text(role.x, role.y, card.role.text, {
        fontFamily: SIGN_FONT,
        fontStyle: '700',
        fontSize: `${Math.round(38 * card.scale)}px`,
        color: '#03314E',
        resolution: RENDER_SCALE,
      })
      .setOrigin(0.5)
      .setAngle(card.angle);

    const iconAt = at(card.icon);
    const icon = this.drawCardIcon(card.icon.kind, card.scale).setPosition(iconAt.x, iconAt.y).setAngle(card.angle);

    // The explanation may take two lines: it starts at hint.y and goes down.
    const hint = at(card.hint);
    const hintText = this.add
      .text(hint.x, hint.y, card.hint.text, {
        fontFamily: SIGN_FONT,
        fontStyle: '700',
        fontSize: `${Math.round(24 * card.scale)}px`,
        color: card.color,
        align: 'center',
        wordWrap: { width: 380 * card.scale },
        resolution: RENDER_SCALE,
      })
      .setOrigin(0.5, 0)
      .setAngle(card.angle);

    const container = this.add
      .container(card.x, INTRO_CARD_BOTTOM_Y, [image, roleText, icon, hintText])
      .setDepth(DEPTH.card);
    // Cards lean towards the outside of the screen; `card.lean` is how much the drawing already leans.
    const side = card.x < GAME_WIDTH / 2 ? -1 : 1;
    setRestAngle(container, side * CARD_LEAN - card.lean);
    return container;
  }

  /**
   * The small line drawing on a player card, in the style of the arrows on
   * the geschiedenis cards (thick rounded lines in the player's colour).
   */
  private drawCardIcon(kind: CardIcon, scale: number): GameObjects.Image {
    const key = kind === 'target' ? ICON_KEYS.target : ICON_KEYS.spell;
    return this.add.image(0, 0, key).setScale((scale * CARD_ICON_SIZE) / RENDER_SCALE);
  }

  /** The big wooden sign (the goal of the game, or the end). */
  private makeSign(heading = SIGN.title.text, body = SIGN.text.text): GameObjects.Container {
    // Upside down, so the post points up (the container's origin is the end of the post).
    const image = this.add
      .image(0, 0, SIGN.key)
      .setOrigin(0.5, 0)
      .setFlipY(true)
      .setScale(SIGN.scale / RENDER_SCALE);
    const at = (p: { x: number; y: number }) => ({
      x: (p.x - SIGN.svgWidth / 2) * SIGN.scale,
      y: p.y * SIGN.scale,
    });

    const title = at(SIGN.title);
    const titleText = this.add
      .text(title.x, title.y, heading, {
        fontFamily: SIGN_FONT,
        fontStyle: '700',
        fontSize: `${Math.round(46 * SIGN.scale)}px`,
        color: '#ffffff',
        resolution: RENDER_SCALE,
      })
      .setOrigin(0.5);
    const text = at(SIGN.text);
    const bodyText = this.add
      .text(text.x, text.y, body, {
        fontFamily: SIGN_FONT,
        fontStyle: '400',
        fontSize: `${Math.round(30 * SIGN.scale)}px`,
        align: 'center',
        // Andika is wider than Oswald: long text goes on two lines.
        wordWrap: { width: SIGN.textWidth * SIGN.scale },
        color: '#ffffff',
        resolution: RENDER_SCALE,
      })
      .setOrigin(0.5, 0);

    return this.add.container(GAME_WIDTH / 2, SIGN.topY, [image, titleText, bodyText]).setDepth(DEPTH.card);
  }

  /** The intro goes (cards, sign, tutorial), the full room appears, then the countdown and the game. */
  private startGame() {
    this.state = 'busy';

    const [sign, cardP2, cardP1] = this.introObjects;
    sinkOut(this, cardP1);
    sinkOut(this, cardP2, { delay: 80 });
    // The sign hangs from the top, so it goes back up.
    sinkOut(this, sign, { delay: 160, distance: -600 });

    // The shelves, torch and cauldron appear: the full room fades in over the empty one.
    const room = this.add
      .image(0, 0, 'fantasy-background')
      .setOrigin(0)
      .setDisplaySize(GAME_WIDTH, GAME_HEIGHT)
      .setDepth(DEPTH.background)
      .setAlpha(0);
    this.tweens.add({ targets: room, alpha: 1, duration: 700, delay: 300 });
    const objects = this.introObjects;
    this.introObjects = [];
    this.removePractice();
    // The umbrella starts the game closed.
    if (this.isUmbrellaOpen) this.toggleUmbrella();

    this.time.delayedCall(800, () => objects.forEach((o) => o.destroy()));

    this.time.delayedCall(700, () => this.countdown(() => {
      this.buildPlayfield();
      this.state = 'playing';
    }));
  }

  /** "Hou je klaar!", then 3, 2, 1 (big, in the middle), then "Start!", and when that goes: `then`. */
  private countdown(then: () => void) {
    const steps = [COUNTDOWN.text, ...COUNTDOWN.numbers, COUNTDOWN.go];
    let delay = 0;
    steps.forEach((step, i) => {
      const isNumber = i > 0 && i <= COUNTDOWN.numbers.length;
      const time = isNumber ? COUNTDOWN.numberTime : COUNTDOWN.readyTime;
      // The game starts when "Start!" goes away.
      if (step === COUNTDOWN.go) this.time.delayedCall(delay + time - 250, then);
      this.time.delayedCall(delay, () => {
        const text = this.add
          .text(GAME_WIDTH / 2, COUNTDOWN.y, step, {
            fontFamily: 'Oswald',
            fontStyle: '700',
            fontSize: isNumber ? '300px' : '150px',
            color: '#FFFFFF',
            resolution: RENDER_SCALE,
          })
          .setOrigin(0.5)
          .setDepth(DEPTH.card)
          .setAngle(TITLE_LETTER_ANGLES[i % TITLE_LETTER_ANGLES.length]);
        // Pops up, stays a moment, then grows a little and fades away.
        this.tweens.add({ targets: text, scale: { from: 0.3, to: 1 }, duration: 350, ease: 'Back.Out' });
        this.tweens.add({
          targets: text,
          alpha: 0,
          scale: 1.3,
          delay: time - 250,
          duration: 250,
          onComplete: () => text.destroy(),
        });
      });
      delay += time;
    });
  }

  // ---------------------------------------------------------------------------
  // Playfield
  // ---------------------------------------------------------------------------

  private buildPlayfield() {
    // The witch, gently swaying (her origin is at her feet).
    this.witch = this.add
      .image(WITCH.x, WITCH.bottomY, WITCH_POSES.idle)
      .setOrigin(0.5, 1)
      .setScale(WITCH.scale / RENDER_SCALE)
      .setDepth(DEPTH.witch);
    riseIn(this, this.witch, { distance: 900, overshoot: false });
    this.witchHealth = WITCH.health;
    this.buildHealthBar();

    this.time.delayedCall(SPELL.firstDelay, () => this.showNextSpell());
    this.time.delayedCall(ATTACK.firstDelay, () => this.witchAttack());
  }

  /**
   * The umbrella (player 1) and the wand (player 2) take over from the hands:
   * from now on they are the players' cursors.
   */
  private createPlayers(umbrellaAt: Point, wandAt: Point) {
    // Player 1: the umbrella (follows the controller). Origin = middle of the canopy.
    const u = PLAYER_PROPS.umbrella;
    this.umbrellaOpen = this.add.image(umbrellaAt.x, umbrellaAt.y, 'fantasy-umbrella-open').setOrigin(0.5, 0.33).setDepth(DEPTH.players);
    this.umbrellaOpen.setScale(u.openWidth / this.umbrellaOpen.width);
    this.umbrellaClosed = this.add.image(umbrellaAt.x, umbrellaAt.y, 'fantasy-umbrella-closed').setDepth(DEPTH.players);
    this.umbrellaClosed.setScale(u.closedHeight / this.umbrellaClosed.height);
    this.umbrellaBadge = this.addPlayerBadge('SPELER 1', PLAYER_COLOR.p1);
    this.isUmbrellaOpen = false;
    this.umbrellaOpen.setVisible(false);
    this.moveUmbrella(umbrellaAt);

    // Player 2: the wand (follows the mouse). Origin = the tip of the wand.
    const w = PLAYER_PROPS.wand;
    this.wand = this.add.image(wandAt.x, wandAt.y, 'fantasy-wand').setOrigin(0.15, 0.04).setDepth(DEPTH.players);
    this.wand.setScale(w.height / this.wand.height);
    this.wandBadge = this.addPlayerBadge('SPELER 2', PLAYER_COLOR.p2);
    this.wandAt = { ...wandAt };
    this.placeWand(wandAt.x, wandAt.y);

    for (const prop of [this.umbrellaOpen, this.umbrellaClosed, this.wand, this.umbrellaBadge, this.wandBadge]) {
      popIn(this, prop, { duration: 350 });
    }

    // The hands go: the wand and the umbrella are the cursors now.
    this.pointers.hide();
    this.input.setDefaultCursor('none');
    // Player 1 (controller) moves the umbrella, player 2 (mouse) the wand.
    // (Without a controller, player 1 plays on the keyboard: ZQSD/arrows + Space, see InputManager.)
    inputManager.on('cursormove', this.moveUmbrella, this);
    this.input.on('pointermove', this.moveWand, this);
    // On the keyboard, player 1's cursor starts at the umbrella.
    inputManager.setKeyboardCursor(umbrellaAt);
  }

  private removeGameplayInput() {
    inputManager.off('cursormove', this.moveUmbrella, this);
    this.input.off('pointermove', this.moveWand, this);
  }

  private addPlayerBadge(text: string, color: number) {
    const { width, height } = BADGE;
    const background = this.add
      .graphics()
      .fillStyle(color, 1)
      .fillRoundedRect(-width / 2, -height / 2, width, height, height / 2);
    const label = this.add
      .text(0, 0, text, {
        fontFamily: 'Oswald',
        fontStyle: '500',
        fontSize: '26px',
        color: '#ffffff',
        resolution: RENDER_SCALE,
      })
      .setOrigin(0.5);
    return this.add.container(0, 0, [background, label]).setDepth(DEPTH.players);
  }

  /** Put a badge below its prop, but always fully on screen. */
  private positionBadge(badge: GameObjects.Container, x: number, y: number) {
    badge.setPosition(
      PMath.Clamp(x, BADGE.width / 2 + 10, GAME_WIDTH - BADGE.width / 2 - 10),
      PMath.Clamp(y, BADGE.height / 2 + 10, GAME_HEIGHT - BADGE.height / 2 - 10),
    );
  }

  // ---------------------------------------------------------------------------
  // Player 1: the umbrella
  // ---------------------------------------------------------------------------

  /** Player 1's controller cursor moved: the umbrella follows. */
  private moveUmbrella({ x, y }: { x: number; y: number }) {
    this.umbrellaAt = { x, y };
    this.umbrellaOpen.setPosition(x, y);
    this.umbrellaClosed.setPosition(x, y);
    this.positionBadge(this.umbrellaBadge, x, y + PLAYER_PROPS.umbrella.badgeY);
    this.checkPracticeUmbrella();
  }

  private toggleUmbrella() {
    this.isUmbrellaOpen = !this.isUmbrellaOpen;
    this.umbrellaClosed.setVisible(!this.isUmbrellaOpen);
    this.umbrellaOpen.setVisible(this.isUmbrellaOpen);
    this.updateSpellLock();
    this.checkPracticeUmbrella();
    // A little pop, so you see it change.
    const shown = this.isUmbrellaOpen ? this.umbrellaOpen : this.umbrellaClosed;
    const scale = shown.scale;
    this.tweens.add({ targets: shown, scale: { from: scale * 0.8, to: scale }, duration: 220, ease: 'Back.Out' });
  }

  // ---------------------------------------------------------------------------
  // Player 2: the wand and the spells
  // ---------------------------------------------------------------------------

  /** Player 2's mouse moved: the wand follows, and maybe traces the spell. */
  private moveWand(pointer: Input.Pointer) {
    const from = this.wandAt;
    const to = { x: pointer.worldX, y: pointer.worldY };
    this.wandAt = to;
    this.placeWand(to.x, to.y);
    this.tracePractice(from, to);
    this.traceSpell(from, to);
  }

  private placeWand(x: number, y: number) {
    this.wand.setPosition(x, y);
    this.positionBadge(this.wandBadge, x + PLAYER_PROPS.wand.badgeX, y + PLAYER_PROPS.wand.badgeY);
  }

  /** Show a new movement to copy (never the same one twice in a row). */
  private showNextSpell() {
    // Only one spell at a time.
    if (this.state !== 'playing' || this.spell) return;
    const options = SPELLS.filter((spell) => spell !== this.lastSpell);
    const spell = options[PMath.Between(0, options.length - 1)];
    this.lastSpell = spell;

    // The dots around (0, 0), the middle of the example.
    const local = resample(placeShape(spell.shape, 0, 0, SPELL_AREA.size), SPELL.dotSpacing);

    const backdrop = this.add.circle(0, 0, SPELL_AREA.size * SPELL_AREA.backdrop, 0x03314e, 0.5);
    // Above the movement: a quote card (like in geschiedenis) with the spell's words and where they come from.
    const quote = this.makeQuoteCard(spell);
    const quoteHeight = (QUOTE.svgHeight * QUOTE.width) / QUOTE.svgWidth;
    quote.setPosition(QUOTE.x, -SPELL_AREA.size * SPELL_AREA.backdrop - quoteHeight / 2 + QUOTE.overlap);
    const { dots: dotsGraphics, traced, start } = this.drawSpellDots(local);

    // "Wait": shown while the umbrella is open. Just white text in our font.
    const lock = this.add
      .text(0, 0, 'Wacht!\nDe paraplu is open', {
        fontFamily: SIGN_FONT,
        fontStyle: '700',
        fontSize: '38px',
        color: '#FFFFFF',
        align: 'center',
        resolution: RENDER_SCALE,
      })
      .setOrigin(0.5);

    const view = this.add
      .container(SPELL_AREA.x, SPELL_AREA.y, [backdrop, quote, dotsGraphics, traced, start, lock])
      .setDepth(DEPTH.spell);
    // The wand has to follow the dots where they are on screen.
    const trace = new SpellTrace(
      local.map((d) => ({ x: d.x + SPELL_AREA.x, y: d.y + SPELL_AREA.y })),
      SPELL.hitRadius,
    );
    this.spell = { def: spell, trace, view, traced, start, local, lock };
    popIn(this, view);
    this.updateSpellLock();
  }

  /** The wand moved from `from` to `to`: check whether it follows the dots. */
  private traceSpell(from: { x: number; y: number }, to: { x: number; y: number }) {
    const spell = this.spell;
    // While the umbrella is open, the wizard has to wait.
    if (!spell || this.state !== 'playing' || this.isUmbrellaOpen || !spell.trace.feed(from, to)) return;

    this.drawTraced(spell.traced, spell.start, spell.local, spell.trace.reached);
    if (spell.trace.done) this.castSpell();
  }

  /**
   * While player 1 holds the umbrella open, player 2 can't cast a spell: the
   * movement goes dim and says "wait". (So the two players have to take turns.)
   */
  private updateSpellLock() {
    const spell = this.spell;
    if (!spell) return;
    const locked = this.isUmbrellaOpen;
    spell.lock.setVisible(locked);
    for (const part of spell.view.list) {
      if (part === spell.lock || part === spell.start) continue;
      (part as GameObjects.Image).setAlpha(locked ? 0.3 : 1);
    }
    // The pulsing start circle has its own alpha animation: hide it instead.
    spell.start.setVisible(!locked && spell.trace.reached === 0);
  }

  /** The quote card: the spell's words, and where they come from (e.g. "Harry Potter"). */
  private makeQuoteCard(spell: SpellDef): GameObjects.Container {
    const scale = QUOTE.width / QUOTE.svgWidth;
    const card = this.add.image(0, 0, QUOTE.key).setScale(scale / RENDER_SCALE);
    // SVG pixels -> position on the card (whose middle is 0, 0).
    const at = (p: { x: number; y: number }) => ({
      x: (p.x - QUOTE.svgWidth / 2) * scale,
      y: (p.y - QUOTE.svgHeight / 2) * scale,
    });
    const lines = spell.name.split('\n').length;
    const words = this.add
      .text(0, 0, spell.name, {
        fontFamily: 'Oswald',
        fontStyle: '700',
        // More lines (a longer spell) = smaller letters, so it fits on the paper.
        fontSize: lines >= 3 ? '30px' : lines === 2 ? '36px' : '44px',
        color: '#03314E',
        align: 'center',
        lineSpacing: -2,
        resolution: RENDER_SCALE,
      })
      .setOrigin(0.5);
    const source = this.add
      .text(0, 0, spell.source, {
        fontFamily: 'Oswald',
        fontStyle: '600',
        fontSize: '22px',
        color: '#63A4AF',
        resolution: RENDER_SCALE,
      })
      .setOrigin(0.5);
    // The words with the source below them, together in the middle of the paper; turned with the paper.
    const middle = at(QUOTE.text);
    const turn = (QUOTE.angle * Math.PI) / 180;
    const along = (d: number) => ({ x: middle.x - Math.sin(turn) * d, y: middle.y + Math.cos(turn) * d });
    const gap = 6;
    const total = words.height + gap + source.height;
    const wordsAt = along(-total / 2 + words.height / 2);
    const sourceAt = along(total / 2 - source.height / 2);
    words.setPosition(wordsAt.x, wordsAt.y).setAngle(QUOTE.angle);
    source.setPosition(sourceAt.x, sourceAt.y).setAngle(QUOTE.angle);

    return this.add.container(0, 0, [card, words, source]);
  }

  /**
   * A movement to follow: white dots with a dark edge (so they show on any
   * background), an arrow at the end, and a pulsing red circle where to start.
   * `traced` is for the part that has been done (see drawTraced).
   */
  private drawSpellDots(local: Point[]) {
    const dots = this.add.graphics();
    local.forEach((d) => dots.fillStyle(0x03314e, 0.9).fillCircle(d.x, d.y, 10).fillStyle(0xffffff, 1).fillCircle(d.x, d.y, 7));
    this.drawArrowHead(dots, local[local.length - 2], local[local.length - 1]);
    const traced = this.add.graphics();
    const start = this.add.circle(local[0].x, local[0].y, 26, SPELL_COLOR, 0.9);
    this.tweens.add({ targets: start, scale: { from: 0.8, to: 1.3 }, alpha: { from: 1, to: 0.5 }, duration: 600, yoyo: true, repeat: -1 });
    return { dots, traced, start };
  }

  /** Draw the part of the movement that has been done (the first `reached` dots) in red. */
  private drawTraced(traced: GameObjects.Graphics, start: GameObjects.Arc, local: Point[], reached: number) {
    const done = local.slice(0, reached);
    traced.clear();
    start.setVisible(done.length === 0);
    if (done.length === 0) return;
    traced.lineStyle(16, SPELL_COLOR, 1);
    if (done.length > 1) {
      traced.beginPath().moveTo(done[0].x, done[0].y);
      done.slice(1).forEach((d) => traced.lineTo(d.x, d.y));
      traced.strokePath();
    }
    traced.fillStyle(SPELL_COLOR, 1).fillCircle(done[done.length - 1].x, done[done.length - 1].y, 14);
  }

  private drawArrowHead(g: GameObjects.Graphics, from: { x: number; y: number }, to: { x: number; y: number }) {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const size = 30;
    const point = (a: number, r: number) => ({ x: to.x + Math.cos(angle + a) * r, y: to.y + Math.sin(angle + a) * r });
    const tip = point(0, size * 0.6);
    const left = point(Math.PI * 0.8, size);
    const right = point(-Math.PI * 0.8, size);
    g.fillStyle(0xffffff, 0.9).fillTriangle(tip.x, tip.y, left.x, left.y, right.x, right.y);
  }

  /** The movement is done: fire the spell at the witch. */
  private castSpell() {
    const spell = this.spell;
    if (!spell) return;
    this.spell = undefined;
    this.tweens.add({ targets: spell.view, alpha: 0, scale: 1.15, duration: 350, onComplete: () => spell.view.destroy() });

    const from = { x: this.wandAt.x, y: this.wandAt.y };
    const target = this.witchChest();
    const onHit = () => {
      this.burst(target.x, target.y);
      this.damageWitch(DAMAGE.spell);
      this.time.delayedCall(SPELL.nextDelay, () => this.showNextSpell());
    };

    if (spell.def.effect === 'deer') {
      this.patronus(from, target, onHit);
    } else if (spell.def.effect === 'sword') {
      this.penToSword(from, target, onHit);
    } else if (spell.def.effect === 'potion') {
      const potion = this.add.image(from.x, from.y, 'fantasy-potion').setDepth(DEPTH.projectile);
      potion.setScale(110 / potion.height);
      this.flyArc(potion, from, target, 260, 750, () => {
        potion.destroy();
        this.splash(target.x, target.y, 0xe84b4b);
        onHit();
      });
    } else {
      const star = this.add.image(from.x, from.y, SPARK_KEY).setDepth(DEPTH.projectile).setScale(1.4 / RENDER_SCALE);
      this.tweens.add({ targets: star, angle: 360, duration: 500, repeat: -1 });
      const trail = this.time.addEvent({ delay: 35, loop: true, callback: () => this.sparkle(star.x, star.y) });
      this.tweens.add({
        targets: star,
        x: target.x,
        y: target.y,
        duration: 600,
        ease: 'Quad.In',
        onComplete: () => {
          trail.remove();
          star.destroy();
          onHit();
        },
      });
    }
  }

  /** Expecto Patronum: a light, a bit see-through deer (hert.svg) goes from the wand straight to the witch. */
  private patronus(from: { x: number; y: number }, target: { x: number; y: number }, onHit: () => void) {
    const deer = this.add
      .image(from.x, from.y - 80, PATRONUS_KEY)
      .setDepth(DEPTH.projectile)
      .setAlpha(0)
      .setScale(0.2 / RENDER_SCALE);
    const scale = PATRONUS.size / (deer.width / RENDER_SCALE) / RENDER_SCALE;
    // It appears out of the wand...
    this.tweens.add({ targets: deer, alpha: PATRONUS.alpha, scale, duration: 450, ease: 'Back.Out' });
    // ...and goes straight to the witch, leaving a trail of light.
    const trail = this.time.addEvent({ delay: 45, loop: true, callback: () => this.sparkle(deer.x, deer.y + 60) });
    this.tweens.add({
      targets: deer,
      x: target.x,
      y: target.y,
      delay: 350,
      duration: PATRONUS.runTime,
      ease: 'Sine.InOut',
      onComplete: () => {
        trail.remove();
        onHit();
        // It fades away in the light.
        this.tweens.add({ targets: deer, alpha: 0, scale: scale * 1.4, duration: 400, onComplete: () => deer.destroy() });
      },
    });
  }

  /** Anaklusmos: the pen flies spinning to the witch and turns into a sword on the way. */
  private penToSword(from: { x: number; y: number }, target: { x: number; y: number }, onHit: () => void) {
    const ps = PEN_SWORD;
    const item = this.add.image(from.x, from.y, ps.penKey).setDepth(DEPTH.projectile);
    const penScale = ps.penSize / item.height;
    item.setScale(penScale);
    let sword = false;
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: ps.flyTime,
      ease: 'Sine.InOut',
      onUpdate: (t) => {
        const p = t.getValue() ?? 0;
        item.x = from.x + (target.x - from.x) * p;
        item.y = from.y + (target.y - from.y) * p - Math.sin(p * Math.PI) * ps.arc;
        item.angle = p * 360 * ps.spins;
        // Halfway: flash, and the pen is a sword.
        if (!sword && p >= ps.changeAt) {
          sword = true;
          this.burst(item.x, item.y);
          item.setTexture(ps.swordKey);
          const swordScale = ps.swordSize / item.height;
          item.setScale(swordScale * 0.6);
          this.tweens.add({ targets: item, scale: swordScale, duration: 250, ease: 'Back.Out' });
        }
      },
      onComplete: () => {
        item.destroy();
        onHit();
      },
    });
  }

  // ---------------------------------------------------------------------------
  // The witch
  // ---------------------------------------------------------------------------

  /** Middle of the witch's body (where spells and bounced attacks hit). */
  private witchChest() {
    return { x: WITCH.x, y: WITCH.bottomY - 430 };
  }

  private buildHealthBar() {
    const bar = HEALTH_BAR;
    const frame = this.add
      .graphics()
      .fillStyle(0xd23636, 1)
      .fillRoundedRect(bar.x - bar.border, bar.y - bar.height / 2 - bar.border, bar.width + bar.border * 2, bar.height + bar.border * 2, (bar.height + bar.border * 2) / 2)
      .fillStyle(0x03314e, 1)
      .fillRoundedRect(bar.x, bar.y - bar.height / 2, bar.width, bar.height, bar.height / 2);
    this.healthFill = this.add.graphics();
    const heart = this.add.image(bar.x - 10, bar.y, HEART_KEY).setScale(1 / RENDER_SCALE);
    this.healthBar = this.add.container(0, 0, [frame, this.healthFill, heart]).setDepth(DEPTH.hud);
    this.healthShown = 1;
    this.healthTween = undefined;
    this.drawHealth(1);
    this.healthBar.setAlpha(0);
    this.tweens.add({ targets: this.healthBar, alpha: 1, duration: 400, delay: 300 });
  }

  private drawHealth(fraction: number) {
    const bar = HEALTH_BAR;
    const width = Math.max(0, bar.width * fraction);
    this.healthFill.clear();
    if (width <= 0) return;
    this.healthFill
      .fillStyle(0xa8e4f0, 1)
      .fillRoundedRect(bar.x, bar.y - bar.height / 2, Math.max(width, bar.height), bar.height, bar.height / 2);
  }

  /** The bar slides to the witch's health now (down after a hit, up when she heals). */
  private slideHealthBar() {
    this.healthTween?.remove();
    this.healthTween = this.tweens.addCounter({
      from: this.healthShown,
      to: this.witchHealth / WITCH.health,
      duration: 400,
      ease: 'Cubic.Out',
      onUpdate: (t) => {
        this.healthShown = t.getValue() ?? 0;
        this.drawHealth(this.healthShown);
      },
    });
  }

  /** The attack was not caught: the witch gets stronger again (never more than full). */
  private healWitch(amount: number) {
    if (this.state !== 'playing' || this.witchHealth >= WITCH.health) return;
    this.witchHealth = Math.min(WITCH.health, this.witchHealth + amount);
    this.slideHealthBar();
    // A green glow and a few sparkles on the witch.
    this.witch.setTint(0xa8f0a0);
    this.time.delayedCall(350, () => this.witch.clearTint());
    const chest = this.witchChest();
    for (let i = 0; i < 6; i++) {
      this.time.delayedCall(i * 70, () => this.sparkle(chest.x + PMath.Between(-120, 120), chest.y + PMath.Between(-150, 150)));
    }
  }

  private damageWitch(amount: number) {
    if (this.state !== 'playing') return;
    this.witchHealth = Math.max(0, this.witchHealth - amount);
    this.slideHealthBar();

    // Ouch: hand on her face, a red flash and a little shake.
    this.setWitchPose('hit', WITCH_POSE_TIME.hit);
    this.witch.setTint(0xff9999);
    this.time.delayedCall(200, () => this.witch.clearTint());
    this.tweens.add({ targets: this.witch, x: { from: WITCH.x - 14, to: WITCH.x }, duration: 300, ease: 'Elastic.Out' });

    if (this.witchHealth <= 0) this.winGame();
  }

  /** Show a pose for a while, then back to standing (unless another pose came in between). */
  private setWitchPose(pose: keyof typeof WITCH_POSES, time?: number) {
    this.witch.setTexture(WITCH_POSES[pose]);
    const id = ++this.poseId;
    if (time) {
      this.time.delayedCall(time, () => {
        if (this.poseId === id && this.state === 'playing') this.witch.setTexture(WITCH_POSES.idle);
      });
    }
  }

  /** The witch throws a flying monkey or a poison potion at the players. */
  private witchAttack() {
    if (this.state !== 'playing') return;

    // Arm up first, then both arms: throw!
    this.setWitchPose('windUp');
    this.time.delayedCall(450, () => {
      if (this.state !== 'playing') return;
      this.setWitchPose('attack', WITCH_POSE_TIME.attack);

      const kind: AttackKind = Math.random() < 0.5 ? 'monkey' : 'potion';
      const side = Math.random() < 0.5 ? -1 : 1;
      const from = { x: WITCH.x + side * 190, y: WITCH.bottomY - 720 };
      const area = ATTACK.targetArea;
      const target = {
        x: PMath.Between(area.x, area.x + area.width),
        y: PMath.Between(area.y, area.y + area.height),
      };
      this.launchAttack(kind, from, target);
    });
  }

  private launchAttack(kind: AttackKind, from: { x: number; y: number }, target: { x: number; y: number }) {
    // Where it will land: a red circle on the floor, so player 1 knows where to hold the umbrella.
    const marker = this.drawLandingCircle(target.x, target.y).setDepth(DEPTH.marker);

    const key = kind === 'monkey' ? 'fantasy-monkey' : 'fantasy-potion';
    const sprite = this.add.image(from.x, from.y, key).setDepth(DEPTH.projectile);
    const size = kind === 'monkey' ? ATTACK.monkeySize : ATTACK.potionSize;
    const fullScale = size / Math.max(sprite.width, sprite.height);
    // Start small right away: otherwise it shows at the size of the image file for
    // one frame (before the flight sets its size), which looks like a flash.
    sprite.setScale(fullScale * 0.45);
    // The monkey looks to the left in the drawing: flip it when it flies to the right.
    if (kind === 'monkey') sprite.setFlipX(target.x > from.x);

    const attack: Attack = { kind, sprite, marker, tween: undefined };
    this.attack = attack;

    // Flies in an arch towards the players, getting bigger (it comes closer).
    attack.tween = this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: ATTACK.flyTime,
      ease: 'Sine.In',
      onUpdate: (t) => {
        const p = t.getValue() ?? 0;
        sprite.x = from.x + (target.x - from.x) * p;
        sprite.y = from.y + (target.y - from.y) * p - Math.sin(p * Math.PI) * 160;
        const flap = kind === 'monkey' ? 1 + Math.sin(p * 40) * 0.08 : 1;
        sprite.setScale(fullScale * (0.45 + 0.55 * p), fullScale * (0.45 + 0.55 * p) * flap);
        if (kind === 'potion') sprite.angle = p * 540;
      },
      // Only when it arrives: is the open umbrella on the circle?
      onComplete: () => {
        if (this.umbrellaBlocks(target.x, target.y)) this.bounceBack(attack);
        else this.attackLands(attack);
      },
    });
  }

  /**
   * A pulsing blue circle on the floor: where player 1 has to hold the umbrella.
   * In player 1's colour, with a white border (like the stickers) so it stands out on the dark floor.
   */
  private drawLandingCircle(x: number, y: number): GameObjects.Graphics {
    const circle = this.add
      .graphics()
      .setPosition(x, y)
      .fillStyle(PLAYER_COLOR.p1, 0.45)
      .fillEllipse(0, 0, 220, 90)
      .lineStyle(16, 0xffffff, 1)
      .strokeEllipse(0, 0, 220, 90)
      .lineStyle(8, PLAYER_COLOR.p1, 1)
      .strokeEllipse(0, 0, 220, 90);
    this.tweens.add({ targets: circle, scale: { from: 0.85, to: 1.1 }, duration: 400, yoyo: true, repeat: -1 });
    return circle;
  }

  /** Is the open umbrella on this spot (the circle where the attack lands)? */
  private umbrellaBlocks(x: number, y: number) {
    return this.isUmbrellaOpen && PMath.Distance.Between(x, y, this.umbrellaAt.x, this.umbrellaAt.y) < ATTACK.blockRadius;
  }

  /** Player 1 caught it with the umbrella: it bounces back to the witch. */
  private bounceBack(attack: Attack) {
    attack.tween?.remove();
    attack.marker.destroy();

    // The umbrella gets a little push, and then closes by itself.
    this.tweens.add({ targets: this.umbrellaOpen, angle: { from: -12, to: 0 }, duration: 500, ease: 'Elastic.Out' });
    this.time.delayedCall(ATTACK.closeAfterBounce, () => {
      if (this.state === 'playing' && this.isUmbrellaOpen) this.toggleUmbrella();
    });

    const target = this.witchChest();
    const sprite = attack.sprite;
    this.flyArc(sprite, { x: sprite.x, y: sprite.y }, target, 200, 650, () => {
      sprite.destroy();
      if (attack.kind === 'potion') this.splash(target.x, target.y, 0x7bd44b);
      else this.burst(target.x, target.y);
      this.damageWitch(DAMAGE.bounce);
      this.endAttack(attack);
    });
    this.tweens.add({ targets: sprite, angle: sprite.angle + 720, scale: sprite.scaleX * 0.7, duration: 650 });
  }

  /** Not caught: it lands near the players and the witch laughs. */
  private attackLands(attack: Attack) {
    attack.marker.destroy();
    const { sprite } = attack;
    this.cameras.main.shake(250, 0.004);
    if (attack.kind === 'potion') {
      this.splash(sprite.x, sprite.y, 0x7bd44b);
      sprite.destroy();
    } else {
      // The monkey flies on, out of the screen.
      const away = sprite.flipX ? GAME_WIDTH + 300 : -300;
      this.tweens.add({ targets: sprite, x: away, y: sprite.y - 400, duration: 900, ease: 'Quad.In', onComplete: () => sprite.destroy() });
    }
    // The witch laughs and gets some health back.
    this.healWitch(HEAL_ON_MISS);
    this.endAttack(attack);
  }

  /** Wait a bit, then the next attack. */
  private endAttack(attack: Attack) {
    if (this.attack === attack) this.attack = undefined;
    this.time.delayedCall(PMath.Between(ATTACK.minPause, ATTACK.maxPause), () => this.witchAttack());
  }

  // ---------------------------------------------------------------------------
  // The end
  // ---------------------------------------------------------------------------

  private winGame() {
    this.state = 'busy';

    // Clear away what is still going on.
    if (this.attack) {
      this.attack.tween?.remove();
      this.attack.marker.destroy();
      this.attack.sprite.destroy();
      this.attack = undefined;
    }
    if (this.spell) {
      this.spell.view.destroy();
      this.spell = undefined;
    }
    this.removeGameplayInput();

    // The witch holds her face for a moment...
    this.witch.setTexture(WITCH_POSES.hit);
    this.tweens.add({ targets: this.healthBar, alpha: 0, duration: 400 });

    // ...then POEF: a cartoon cloud, and she's gone. The book comes out when the cloud dissolves.
    this.time.delayedCall(WITCH_END.holdTime, () => {
      const chest = this.witchChest();
      this.poof(chest.x, chest.y, () => this.showBook());
      // Hidden as soon as the cloud covers her.
      this.time.delayedCall(250, () => {
        this.tweens.killTweensOf(this.witch);
        this.witch.setVisible(false);
      });
    });

    // The wand and umbrella go; the hands come back.
    this.time.delayedCall(WITCH_END.holdTime + 500, () => {
      for (const prop of [this.umbrellaOpen, this.umbrellaClosed, this.wand, this.umbrellaBadge, this.wandBadge]) {
        this.tweens.add({ targets: prop, alpha: 0, duration: 300 });
      }
      this.pointers.show();
    });
  }

  /** The closed book appears where the witch was, and opens by itself after a moment. */
  private showBook() {
    const chest = this.witchChest();
    // Just behind the clouds: it is there when they shrink away.
    const closed = this.add.image(chest.x, chest.y, BOOK.closedKey).setDepth(DEPTH.smoke - 0.5);
    const scale = BOOK.closedHeight / closed.height;

    // It pops out of the smoke with some sparkles, and floats a little.
    closed.setScale(0);
    this.tweens.add({ targets: closed, scale, duration: 600, ease: 'Back.Out' });
    this.tweens.add({ targets: closed, angle: { from: -12, to: 0 }, duration: 1200, ease: 'Elastic.Out' });
    this.tweens.add({ targets: closed, y: chest.y - 20, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut', delay: 600 });
    this.burst(chest.x, chest.y);
    this.bookSparkles = this.time.addEvent({
      delay: 90,
      loop: true,
      callback: () => this.sparkle(closed.x + PMath.Between(-150, 150), closed.y + PMath.Between(-180, 180)),
    });
    this.closedBook = closed;
    this.closedBookScale = scale;

    // After a moment (when the clouds are gone) it opens by itself.
    this.time.delayedCall(BOOK.openDelay, () => this.openBook());
  }

  /** Dark background, and the book opens big in the middle (like at the end of geschiedenis). */
  private openBook() {
    this.state = 'done';
    this.bookSparkles?.remove();
    const closed = this.closedBook;
    if (closed) {
      this.tweens.killTweensOf(closed);
      this.tweens.add({ targets: closed, alpha: 0, scale: this.closedBookScale * 1.2, duration: 400 });
    }

    const overlay = this.add
      .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000)
      .setOrigin(0)
      .setDepth(DEPTH.book - 1)
      .setAlpha(0);
    this.tweens.add({ targets: overlay, alpha: 0.8, duration: 400 });

    const open = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, BOOK.openKey).setDepth(DEPTH.book + 1).setAlpha(0);
    const openScale = Math.min((GAME_WIDTH * 0.9) / open.width, (GAME_HEIGHT * 0.85) / open.height);
    open.setScale(openScale * 0.6);
    this.tweens.add({ targets: open, alpha: 1, scale: openScale, duration: 600, ease: 'Back.Out' });

    // The back button goes on top, to go back to the menu.
    this.backButton?.setDepth(DEPTH.book + 2);
  }

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------

  /** Make the star and heart images (drawn here, so no extra files are needed). */
  private makeTextures() {
    if (!this.textures.exists(SPARK_KEY)) {
      const size = 64 * RENDER_SCALE;
      const texture = this.textures.createCanvas(SPARK_KEY, size, size);
      const ctx = texture?.getContext();
      if (texture && ctx) {
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const r = i % 2 === 0 ? size * 0.46 : size * 0.2;
          const a = (i * Math.PI) / 5 - Math.PI / 2;
          ctx.lineTo(size / 2 + Math.cos(a) * r, size / 2 + Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fillStyle = '#FFD84A';
        ctx.fill();
        ctx.lineWidth = 3 * RENDER_SCALE;
        ctx.strokeStyle = '#FFFFFF';
        ctx.stroke();
        texture.refresh();
      }
    }
    if (!this.textures.exists(CLOUD_KEY)) {
      // A flat cartoon cloud with a white sticker border, like the other drawings.
      const w = 300 * RENDER_SCALE;
      const h = 230 * RENDER_SCALE;
      const texture = this.textures.createCanvas(CLOUD_KEY, w, h);
      const ctx = texture?.getContext();
      if (texture && ctx) {
        // Bumps of the cloud: x, y, radius (as a fraction of the width).
        const bumps = [
          [0.27, 0.6, 0.19],
          [0.45, 0.4, 0.24],
          [0.68, 0.45, 0.2],
          [0.75, 0.66, 0.16],
          [0.5, 0.68, 0.2],
        ];
        const circles = (grow: number, dx = 0, dy = 0, shrink = 1) => {
          ctx.beginPath();
          for (const [x, y, r] of bumps) {
            const cx = (x + dx) * w;
            const cy = y * h + dy * w;
            const radius = r * shrink * w + grow;
            ctx.moveTo(cx + radius, cy);
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          }
        };
        const border = 9 * RENDER_SCALE;
        circles(border);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
        circles(0);
        ctx.fillStyle = '#BFB2E6';
        ctx.fill();
        // Lighter top part, so the shadow shows at the bottom.
        ctx.save();
        circles(0);
        ctx.clip();
        circles(0, -0.02, -0.05, 0.92);
        ctx.fillStyle = '#E9E3F8';
        ctx.fill();
        ctx.restore();
        texture.refresh();
      }
    }
    // The line drawings on the player cards (see drawCardIcon).
    const lineIcon = (key: string, width: number, height: number, color: string, draw: (ctx: CanvasRenderingContext2D) => void) => {
      if (this.textures.exists(key)) return;
      const texture = this.textures.createCanvas(key, width * RENDER_SCALE, height * RENDER_SCALE);
      const ctx = texture?.getContext();
      if (!texture || !ctx) return;
      ctx.scale(RENDER_SCALE, RENDER_SCALE);
      ctx.strokeStyle = color;
      ctx.lineWidth = 6.7;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      draw(ctx);
      texture.refresh();
    };
    const arrowHead = (ctx: CanvasRenderingContext2D, x: number, y: number, angle: number) => {
      ctx.beginPath();
      for (const side of [-1, 1]) {
        ctx.moveTo(x, y);
        ctx.lineTo(x - Math.cos(angle + side * 0.6) * 18, y - Math.sin(angle + side * 0.6) * 18);
      }
      ctx.stroke();
    };
    // Player 1: an arrow coming down onto a circle on the floor (where the attack lands).
    lineIcon(ICON_KEYS.target, 180, 84, '#2B69B4', (ctx) => {
      // The circle in our light blue (like the umbrella and the deer), the arrow in blue.
      ctx.strokeStyle = '#A7E6F1';
      ctx.beginPath();
      ctx.ellipse(90, 58, 70, 20, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#2B69B4';
      ctx.beginPath();
      ctx.moveTo(90, 6);
      ctx.lineTo(90, 44);
      ctx.stroke();
      arrowHead(ctx, 90, 46, Math.PI / 2);
    });
    // Player 2: a wavy arrow (follow the movement of the spell).
    lineIcon(ICON_KEYS.spell, 200, 80, '#D23636', (ctx) => {
      ctx.beginPath();
      for (let i = 0; i <= 40; i++) {
        const x = 12 + (165 * i) / 40;
        const y = 40 - Math.sin((i / 40) * Math.PI * 2) * 20;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      // The wave ends going up again: the arrow points along it.
      arrowHead(ctx, 178, 40, -Math.atan2(20 * Math.PI * 2, 165) );
    });

    if (!this.textures.exists(HEART_KEY)) {
      const size = HEALTH_BAR.heartSize * RENDER_SCALE;
      const texture = this.textures.createCanvas(HEART_KEY, size, size);
      const ctx = texture?.getContext();
      if (texture && ctx) {
        const s = size / 100;
        ctx.beginPath();
        ctx.moveTo(50 * s, 92 * s);
        ctx.bezierCurveTo(10 * s, 62 * s, 2 * s, 40 * s, 6 * s, 26 * s);
        ctx.bezierCurveTo(12 * s, 6 * s, 40 * s, 2 * s, 50 * s, 24 * s);
        ctx.bezierCurveTo(60 * s, 2 * s, 88 * s, 6 * s, 94 * s, 26 * s);
        ctx.bezierCurveTo(98 * s, 40 * s, 90 * s, 62 * s, 50 * s, 92 * s);
        ctx.closePath();
        ctx.fillStyle = '#E05555';
        ctx.fill();
        texture.refresh();
      }
    }
  }

  /** Text that pops up, floats up a bit and disappears. */
  /** Stars flying out from a point (a hit). */
  private burst(x: number, y: number) {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + Math.random() * 0.4;
      const star = this.add
        .image(x, y, SPARK_KEY)
        .setDepth(DEPTH.projectile)
        .setScale((0.5 + Math.random() * 0.5) / RENDER_SCALE);
      this.tweens.add({
        targets: star,
        x: x + Math.cos(a) * PMath.Between(110, 190),
        y: y + Math.sin(a) * PMath.Between(110, 190),
        angle: 180,
        alpha: 0,
        duration: 600,
        ease: 'Cubic.Out',
        onComplete: () => star.destroy(),
      });
    }
  }

  /**
   * Cartoon "poef": clouds pop up one after the other (with a burst of stars),
   * stay a moment, then shrink away one by one. `onDissolve` is called just
   * before they go, so something can appear behind them.
   */
  private poof(x: number, y: number, onDissolve: () => void) {
    const clouds = POOF_CLOUDS.map((spot, i) => {
      const cloud = this.add
        .image(x + spot.x, y + spot.y, CLOUD_KEY)
        .setDepth(DEPTH.smoke)
        .setAngle(PMath.Between(-12, 12))
        .setFlipX(i % 2 === 1)
        .setScale(0);
      const scale = spot.size / cloud.width;
      this.tweens.add({ targets: cloud, scale, delay: i * 45, duration: 320, ease: 'Back.Out', easeParams: [2.5] });
      // A little wobble while it hangs there.
      this.tweens.add({
        targets: cloud,
        scale: scale * 1.06,
        delay: 400 + i * 45,
        duration: 260,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      });
      return cloud;
    });

    this.burst(x, y);

    // Then the clouds shrink away one by one, with a few stars.
    this.time.delayedCall(WITCH_END.cloudTime - 500, onDissolve);
    this.time.delayedCall(WITCH_END.cloudTime, () => {
      clouds.forEach((cloud, i) => {
        this.time.delayedCall(i * 90, () => {
          this.tweens.killTweensOf(cloud);
          this.sparkle(cloud.x, cloud.y);
          this.tweens.add({
            targets: cloud,
            scale: 0,
            angle: cloud.angle + PMath.Between(-40, 40),
            duration: 350,
            ease: 'Back.In',
            onComplete: () => cloud.destroy(),
          });
        });
      });
    });
  }

  /** A small fading star (trail behind a spell). */
  private sparkle(x: number, y: number) {
    const star = this.add
      .image(x + PMath.Between(-12, 12), y + PMath.Between(-12, 12), SPARK_KEY)
      .setDepth(DEPTH.projectile)
      .setScale(0.5 / RENDER_SCALE);
    this.tweens.add({ targets: star, scale: 0, alpha: 0, duration: 400, onComplete: () => star.destroy() });
  }

  /** A splash of potion. */
  private splash(x: number, y: number, color: number) {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const drop = this.add.circle(x, y, PMath.Between(14, 26), color).setDepth(DEPTH.projectile);
      this.tweens.add({
        targets: drop,
        x: x + Math.cos(a) * PMath.Between(80, 150),
        y: y + Math.sin(a) * PMath.Between(60, 120),
        scale: 0.3,
        alpha: 0,
        duration: 550,
        ease: 'Cubic.Out',
        onComplete: () => drop.destroy(),
      });
    }
  }

  /** Fly an object in an arch from one point to another. */
  private flyArc(
    target: GameObjects.Image,
    from: { x: number; y: number },
    to: { x: number; y: number },
    height: number,
    duration: number,
    onComplete: () => void,
  ) {
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration,
      ease: 'Sine.InOut',
      onUpdate: (t) => {
        const p = t.getValue() ?? 0;
        target.x = from.x + (to.x - from.x) * p;
        target.y = from.y + (to.y - from.y) * p - Math.sin(p * Math.PI) * height;
      },
      onComplete,
    });
  }
}
