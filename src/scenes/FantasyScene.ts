import { GameObjects, Input, Math as PMath, Scene, type Time, type Tweens, type Types } from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE, setupCamera } from '../config';
import { inputManager } from '../input/InputManager';
import { dropIn, popIn, riseIn, setRestAngle, sinkOut, slideIn, slideOut } from '../puppet';
import { PlayerPointers } from '../playerPointers';
import { addPressButtonText } from '../ui';
import { placeShape, resample, SPELLS, SpellTrace, type SpellDef } from './fantasySpells';

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
 *  2. A button press starts the game:
 *     - player 1 (controller, left, blue) is the protector with the umbrella;
 *       the controller button (or Space) opens/closes the umbrella.
 *     - player 2 (mouse, right, red) is the wizard with the wand.
 *     Spells and witch attacks come later.
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
    umbrella: { x: 590, y: 690, height: 230, angle: -15 },
    wand: { x: 1300, y: 640, height: 280, angle: 20 },
  },
};

/** Cards and the intro sign stand with the end of their stick well below the screen. */
const CARD_BOTTOM_Y = GAME_HEIGHT + 110;
/** How far (degrees) the cards lean towards the outside of the screen. */
const CARD_LEAN = 5;
/** "druk op een knop om het spel te starten" in the intro, at the bottom between the cards. */
const PRESS_TEXT_Y = 1150;

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
    svgWidth: 548,
    svgHeight: 782,
    x: 395,
    scale: 0.9,
    lean: 5.5,
    angle: 4.1,
    color: '#2B69B4',
    role: { text: 'Jij beschermt!', x: 284, y: 150 },
    hint: { text: 'richt je paraplu en druk op de knop', x: 277, y: 258 },
  },
  p2: {
    key: 'fantasy-card-p2',
    file: 'speler2-stap1.svg',
    svgWidth: 653,
    svgHeight: 957,
    x: 1480,
    scale: 0.89,
    lean: -1.8,
    angle: -5,
    color: '#D23636',
    role: { text: 'Jij tovert!', x: 277, y: 203 },
    hint: { text: 'zwaai je toverstaf heen en weer', x: 287, y: 318 },
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
  /** The book can be clicked open this long (ms) after it appeared (when the clouds are gone). */
  readyDelay: 1600,
  /** "druk op een knop om het boek te openen", below the closed book. */
  hintY: 830,
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

/** Decoration on the playfield. */
const PLAYFIELD = {
  shelves: [
    { key: 'fantasy-shelf-1', x: 310, bottomY: 292 },
    { key: 'fantasy-shelf-2', x: 310, bottomY: 525 },
  ],
  torch: { x: 1350, bottomY: 420, width: 110 },
  cauldron: { x: 1580, bottomY: 900, width: 460 },
};

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

/** The witch's health bar at the top, with a heart in front. */
const HEALTH_BAR = { x: 1040, y: 98, width: 820, height: 38, border: 6, heartSize: 96 };

/** The props the players hold while playing. Sizes in game pixels. */
const PLAYER_PROPS = {
  umbrella: { startX: 300, startY: 1000, openWidth: 250, closedHeight: 190, badgeY: 175 },
  wand: { startX: 1300, startY: 1050, height: 200, badgeX: 70, badgeY: 225 },
};
const BADGE = { width: 150, height: 48 };
/**
 * For testing without a controller: player 1 plays with the keyboard.
 * WASD (or the arrow keys) move the umbrella, Space or Enter is player 1's button.
 * Player 2 keeps the mouse/trackpad.
 */
const KEYBOARD_SPEED = 900;
const MOVE_KEYS: Record<string, { x: number; y: number }> = {
  w: { x: 0, y: -1 },
  a: { x: -1, y: 0 },
  s: { x: 0, y: 1 },
  d: { x: 1, y: 0 },
  arrowup: { x: 0, y: -1 },
  arrowleft: { x: -1, y: 0 },
  arrowdown: { x: 0, y: 1 },
  arrowright: { x: 1, y: 0 },
};

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
  /** How close (px) the attack has to come to the middle of the open umbrella to bounce back. */
  blockRadius: 150,
  /** The umbrella only catches the attack in the last part of its flight (0..1). */
  blockFrom: 0.45,
  monkeySize: 230,
  potionSize: 140,
};

/** Where the movement for a spell is shown (center and size, game pixels). */
const SPELL_AREA = { x: 1520, y: 600, size: 360 };
const SPELL = {
  /** First spell this many ms after the game starts; the next one this long after casting. */
  firstDelay: 1500,
  nextDelay: 1200,
  /** Distance between the dots of the movement. */
  dotSpacing: 42,
  /** How close (px) the tip of the wand has to come to a dot: bigger = easier. */
  hitRadius: 75,
};
const SPELL_COLOR = 0xffd84a;
/** Expecto Patronum: the glowing rabbit (size = width on screen, alpha = how see-through, hops on its way). */
const PATRONUS = { size: 260, alpha: 0.85, runTime: 1300, hops: 3 };
/** The Golden Cap spell: how many flying monkeys attack the witch, and the time between them. */
const MONKEY_SPELL = { count: 3, gap: 220, size: 170 };

/** Images that are drawn in code (see makeTextures). */
const SPARK_KEY = 'fantasy-spark';
const HEART_KEY = 'fantasy-heart';
const PATRONUS_KEY = 'fantasy-patronus';
const CLOUD_KEY = 'fantasy-cloud';

/** Draw order (higher = on top). */
const DEPTH = {
  background: 0,
  props: 2,
  marker: 3,
  witch: 4,
  projectile: 5,
  spell: 6,
  hud: 8,
  players: 10,
  shout: 12,
  smoke: 11,
  backButton: 14,
  card: 15,
  introProp: 16,
  book: 18,
};

type State = 'title' | 'titleReady' | 'intro' | 'introReady' | 'busy' | 'playing' | 'bookReady' | 'done';
type AttackKind = 'monkey' | 'potion';

/** An attack of the witch that is on its way. */
interface Attack {
  kind: AttackKind;
  sprite: GameObjects.Image;
  marker: GameObjects.Graphics;
  tween?: Tweens.Tween;
  blocked: boolean;
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
  private introPress?: GameObjects.Text;
  /** The players' hands, on the title and intro (while playing, the wand and umbrella are the cursor). */
  private pointers!: PlayerPointers;
  private backButton?: GameObjects.Image;
  /** The end: the closed book (opened with a button press). */
  private closedBook?: GameObjects.Image;
  private closedBookScale = 1;
  private bookSparkles?: Time.TimerEvent;
  private bookHint?: GameObjects.Text;

  private umbrellaClosed!: GameObjects.Image;
  private umbrellaOpen!: GameObjects.Image;
  private umbrellaBadge!: GameObjects.Container;
  private wand!: GameObjects.Image;
  private wandBadge!: GameObjects.Container;
  private isUmbrellaOpen = false;
  /** Where the umbrella and the tip of the wand are. */
  private umbrellaAt = { x: 0, y: 0 };
  private wandAt = { x: 0, y: 0 };
  /** Movement keys of player 1 that are held down (testing without a controller). */
  private heldKeys = new Set<string>();

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

    this.load.image('fantasy-background', PATH + 'fantasyBackground.png');
    svg(WITCH_POSES.idle, 'theWitch-poseDown.svg');
    svg(WITCH_POSES.windUp, 'theWitch-poseOneArm.svg');
    svg(WITCH_POSES.attack, 'theWitch-attack.svg');
    svg(WITCH_POSES.hit, 'theWitch-afterAttacked.svg');
    svg('fantasy-monkey', 'monkey.svg');
    svg('fantasy-potion', 'potion1.svg');
    svg('fantasy-shelf-1', 'potionShelf1.svg');
    svg('fantasy-shelf-2', 'potionShelf2.svg');
    svg('fantasy-cauldron', 'couldron.svg');
    svg('fantasy-torch', 'torch.svg');
    svg('fantasy-wand', 'wand.svg');
    svg('fantasy-umbrella-open', 'umbrellaOpen.svg');
    svg('fantasy-umbrella-closed', 'umbrella-closed.svg');
    svg(SIGN.key, SIGN.file);
    this.load.image(BOOK.closedKey, BOOK.closedFile);
    this.load.image(BOOK.openKey, BOOK.openFile);
    Object.values(CARDS).forEach((card) => svg(card.key, card.file));
    // Shared with the geschiedenis game.
    this.load.image('fantasy-back', 'assets/minigame-geschiedenis/back-button.png');
    PlayerPointers.preload(this);
  }

  create() {
    setupCamera(this);
    // The background image is partly transparent: dark blue behind it.
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
    this.introPress = undefined;
    this.isUmbrellaOpen = false;
    this.witchHealth = WITCH.health;
    this.poseId = 0;
    this.attack = undefined;
    this.spell = undefined;
    this.lastSpell = undefined;
    this.closedBook = undefined;
    this.bookSparkles = undefined;
    this.bookHint = undefined;
    this.heldKeys.clear();
    this.makeTextures();

    this.add
      .image(0, 0, 'fantasy-background')
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
    // Capture phase: we see the keys before the input manager (where D = debug panel).
    window.addEventListener('keydown', this.onTestKey, true);
    window.addEventListener('keyup', this.onTestKey, true);
    this.events.once('shutdown', () => {
      this.input.off('pointerup', this.pressButton, this);
      inputManager.off('select', this.onPlayer1Button, this);
      window.removeEventListener('keydown', this.onTestKey, true);
      window.removeEventListener('keyup', this.onTestKey, true);
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
    else if (this.state === 'introReady') this.startGame();
    else if (this.state === 'bookReady') this.openBook();
  }

  /** Player 1's button (controller button or Space): opens/closes the umbrella while playing. */
  private onPlayer1Button({ player }: { player?: number }) {
    if (player !== 1) return;
    if (this.state === 'playing') this.toggleUmbrella();
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

    // "druk op een knop om het spel te starten" just above the sign.
    void addPressButtonText(this, GAME_WIDTH / 2, PRESS_TEXT_Y, { depth: DEPTH.card, delay: 900 }).then((press) => {
      if (!press) return;
      if (this.state === 'intro' || this.state === 'introReady') this.introPress = press;
      else press.destroy();
    });

    this.time.delayedCall(1400, () => {
      if (this.state === 'intro') this.state = 'introReady';
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

    const role = at(card.role);
    const roleText = this.add
      .text(role.x, role.y, card.role.text, {
        fontFamily: 'Oswald',
        fontStyle: '500',
        fontSize: `${Math.round(36 * card.scale)}px`,
        color: '#03314E',
        resolution: RENDER_SCALE,
      })
      .setOrigin(0.5)
      .setAngle(card.angle);
    const hint = at(card.hint);
    const hintText = this.add
      .text(hint.x, hint.y, card.hint.text, {
        fontFamily: 'Oswald',
        fontStyle: '500',
        fontSize: `${Math.round(22 * card.scale)}px`,
        color: card.color,
        resolution: RENDER_SCALE,
      })
      .setOrigin(0.5)
      .setAngle(card.angle);

    const container = this.add.container(card.x, CARD_BOTTOM_Y, [image, roleText, hintText]).setDepth(DEPTH.card);
    // Cards lean towards the outside of the screen: left cards to the left, right cards to the right.
    const side = card.x < GAME_WIDTH / 2 ? -1 : 1;
    setRestAngle(container, side * CARD_LEAN - card.lean);
    return container;
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

  private startGame() {
    this.state = 'busy';

    const press = this.introPress;
    this.introPress = undefined;
    if (press) {
      this.tweens.killTweensOf(press);
      this.tweens.add({ targets: press, alpha: 0, duration: 250, onComplete: () => press.destroy() });
    }

    const [sign, cardP2, cardP1] = this.introObjects;
    sinkOut(this, cardP1);
    sinkOut(this, cardP2, { delay: 80 });
    // The sign hangs from the top, so it goes back up.
    sinkOut(this, sign, { delay: 160, distance: -600 });
    const objects = this.introObjects;
    this.introObjects = [];

    const wand = this.introWand;
    const umbrella = this.introUmbrella;
    this.introWand = undefined;
    this.introUmbrella = undefined;
    if (umbrella) slideOut(this, umbrella, 'left');
    if (wand) slideOut(this, wand, 'right');

    this.time.delayedCall(800, () => {
      objects.forEach((o) => o.destroy());
      wand?.destroy();
      umbrella?.destroy();
    });

    this.time.delayedCall(500, () => {
      this.buildPlayfield();
      // The hands turn into the wand and the umbrella: the game has started.
      this.pointers.hide();
      this.input.setDefaultCursor('none');
      this.state = 'playing';
      // Player 1 (controller) moves the umbrella, player 2 (mouse) the wand.
      inputManager.on('cursormove', this.moveUmbrella, this);
      this.input.on('pointermove', this.moveWand, this);
    });
  }

  // ---------------------------------------------------------------------------
  // Playfield
  // ---------------------------------------------------------------------------

  private buildPlayfield() {
    for (const shelf of PLAYFIELD.shelves) {
      this.addProp(shelf.key, shelf.x, shelf.bottomY, 520, DEPTH.props);
    }
    this.addProp('fantasy-torch', PLAYFIELD.torch.x, PLAYFIELD.torch.bottomY, PLAYFIELD.torch.width, DEPTH.props);
    this.addProp('fantasy-cauldron', PLAYFIELD.cauldron.x, PLAYFIELD.cauldron.bottomY, PLAYFIELD.cauldron.width, DEPTH.props);

    // The witch, gently swaying (her origin is at her feet).
    this.witch = this.add
      .image(WITCH.x, WITCH.bottomY, WITCH_POSES.idle)
      .setOrigin(0.5, 1)
      .setScale(WITCH.scale / RENDER_SCALE)
      .setDepth(DEPTH.witch);
    riseIn(this, this.witch, { distance: 900, overshoot: false });
    this.witchHealth = WITCH.health;
    this.buildHealthBar();

    // Player 1: the umbrella (follows the controller). Origin = middle of the canopy.
    const u = PLAYER_PROPS.umbrella;
    this.umbrellaOpen = this.add.image(u.startX, u.startY, 'fantasy-umbrella-open').setOrigin(0.5, 0.33).setDepth(DEPTH.players);
    this.umbrellaOpen.setScale(u.openWidth / this.umbrellaOpen.width);
    this.umbrellaClosed = this.add.image(u.startX, u.startY, 'fantasy-umbrella-closed').setDepth(DEPTH.players);
    this.umbrellaClosed.setScale(u.closedHeight / this.umbrellaClosed.height);
    this.umbrellaBadge = this.addPlayerBadge('SPELER 1', 0x2b69b4);
    this.isUmbrellaOpen = false;
    this.umbrellaOpen.setVisible(false);
    this.moveUmbrella({ x: u.startX, y: u.startY });

    // Player 2: the wand (follows the mouse). Origin = the tip of the wand.
    const w = PLAYER_PROPS.wand;
    this.wand = this.add.image(w.startX, w.startY, 'fantasy-wand').setOrigin(0.15, 0.04).setDepth(DEPTH.players);
    this.wand.setScale(w.height / this.wand.height);
    this.wandBadge = this.addPlayerBadge('SPELER 2', 0xd23636);
    this.wandAt = { x: w.startX, y: w.startY };
    this.placeWand(this.wandAt.x, this.wandAt.y);

    for (const prop of [this.umbrellaOpen, this.umbrellaClosed, this.wand, this.umbrellaBadge, this.wandBadge]) {
      popIn(this, prop, { delay: 300 });
    }


    this.time.delayedCall(SPELL.firstDelay, () => this.showNextSpell());
    this.time.delayedCall(ATTACK.firstDelay, () => this.witchAttack());
  }

  private removeGameplayInput() {
    inputManager.off('cursormove', this.moveUmbrella, this);
    this.input.off('pointermove', this.moveWand, this);
  }

  private addProp(key: string, x: number, bottomY: number, width: number, depth: number): GameObjects.Image {
    const image = this.add.image(x, bottomY, key).setOrigin(0.5, 1).setDepth(depth);
    image.setScale(width / image.width);
    return image;
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
  }

  private toggleUmbrella() {
    this.isUmbrellaOpen = !this.isUmbrellaOpen;
    this.umbrellaClosed.setVisible(!this.isUmbrellaOpen);
    this.umbrellaOpen.setVisible(this.isUmbrellaOpen);
    this.updateSpellLock();
    // A little pop, so you see it change.
    const shown = this.isUmbrellaOpen ? this.umbrellaOpen : this.umbrellaClosed;
    const scale = shown.scale;
    this.tweens.add({ targets: shown, scale: { from: scale * 0.8, to: scale }, duration: 220, ease: 'Back.Out' });
  }

  /**
   * Testing without a controller: player 1 on the keyboard (WASD/arrows + Space/Enter).
   * Only while no controller is in use; with a controller the keys work as before.
   */
  private onTestKey = (event: KeyboardEvent) => {
    if (inputManager.getMode() !== 'mouse' || event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();

    if (MOVE_KEYS[key]) {
      // Outside the game itself the keys keep their normal job (D = debug panel).
      if (event.type === 'keydown' && this.state !== 'playing') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === 'keydown') this.heldKeys.add(key);
      else this.heldKeys.delete(key);
    } else if ((key === ' ' || key === 'enter') && event.type === 'keydown') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) this.onPlayer1Button({ player: 1 });
    }
  };

  update(_time: number, delta: number) {
    if (this.state !== 'playing' || this.heldKeys.size === 0 || inputManager.getMode() !== 'mouse') return;
    // Player 1 on the keyboard: the held keys move the umbrella.
    let dx = 0;
    let dy = 0;
    for (const key of this.heldKeys) {
      dx += MOVE_KEYS[key].x;
      dy += MOVE_KEYS[key].y;
    }
    dx = PMath.Clamp(dx, -1, 1);
    dy = PMath.Clamp(dy, -1, 1);
    if (dx === 0 && dy === 0) return;
    const step = (KEYBOARD_SPEED * delta) / 1000;
    this.moveUmbrella({
      x: PMath.Clamp(this.umbrellaAt.x + dx * step, 0, GAME_WIDTH),
      y: PMath.Clamp(this.umbrellaAt.y + dy * step, 0, GAME_HEIGHT),
    });
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
    this.traceSpell(from, to);
  }

  private placeWand(x: number, y: number) {
    this.wand.setPosition(x, y);
    this.positionBadge(this.wandBadge, x + PLAYER_PROPS.wand.badgeX, y + PLAYER_PROPS.wand.badgeY);
  }

  /** Show a new movement to copy (never the same one twice in a row). */
  private showNextSpell() {
    if (this.state !== 'playing') return;
    const options = SPELLS.filter((spell) => spell !== this.lastSpell);
    const spell = options[PMath.Between(0, options.length - 1)];
    this.lastSpell = spell;

    const line = placeShape(spell.shape, SPELL_AREA.x, SPELL_AREA.y, SPELL_AREA.size);
    const dots = resample(line, SPELL.dotSpacing);
    const trace = new SpellTrace(dots, SPELL.hitRadius);

    const backdrop = this.add.circle(0, 0, SPELL_AREA.size * 0.72, 0x03314e, 0.6);
    const name = this.add
      .text(0, -SPELL_AREA.size * 0.72 - 14, spell.name, {
        fontFamily: 'Oswald',
        fontStyle: '600',
        fontSize: '40px',
        color: '#ffffff',
        align: 'center',
        resolution: RENDER_SCALE,
      })
      // Bottom-center: a name of more lines grows upwards.
      .setOrigin(0.5, 1);
    const local = dots.map((d) => ({ x: d.x - SPELL_AREA.x, y: d.y - SPELL_AREA.y }));
    const dotsGraphics = this.add.graphics();
    dotsGraphics.fillStyle(0xffffff, 0.75);
    local.forEach((d) => dotsGraphics.fillCircle(d.x, d.y, 7));
    this.drawArrowHead(dotsGraphics, local[local.length - 2], local[local.length - 1]);
    const traced = this.add.graphics();
    // Where to start: a pulsing yellow circle.
    const start = this.add.circle(local[0].x, local[0].y, 26, SPELL_COLOR, 0.9);
    this.tweens.add({ targets: start, scale: { from: 0.8, to: 1.3 }, alpha: { from: 1, to: 0.5 }, duration: 600, yoyo: true, repeat: -1 });

    // "Wait": shown while the umbrella is open.
    const lock = this.add
      .text(0, 0, 'Wacht!\nDe paraplu is open', {
        fontFamily: 'Oswald',
        fontStyle: '600',
        fontSize: '40px',
        color: '#ffffff',
        align: 'center',
        resolution: RENDER_SCALE,
      })
      .setOrigin(0.5);

    const view = this.add
      .container(SPELL_AREA.x, SPELL_AREA.y, [backdrop, name, dotsGraphics, traced, start, lock])
      .setDepth(DEPTH.spell);
    popIn(this, view);
    this.spell = { def: spell, trace, view, traced, start, local, lock };
    this.updateSpellLock();
  }

  /** The wand moved from `from` to `to`: check whether it follows the dots. */
  private traceSpell(from: { x: number; y: number }, to: { x: number; y: number }) {
    const spell = this.spell;
    // While the umbrella is open, the wizard has to wait.
    if (!spell || this.state !== 'playing' || this.isUmbrellaOpen || !spell.trace.feed(from, to)) return;

    // Draw the part that has been done in yellow.
    const done = spell.local.slice(0, spell.trace.reached);
    spell.traced.clear().lineStyle(16, SPELL_COLOR, 1);
    if (done.length > 1) {
      spell.traced.beginPath().moveTo(done[0].x, done[0].y);
      done.slice(1).forEach((d) => spell.traced.lineTo(d.x, d.y));
      spell.traced.strokePath();
    }
    spell.traced.fillStyle(SPELL_COLOR, 1).fillCircle(done[done.length - 1].x, done[done.length - 1].y, 14);
    spell.start.setVisible(false);

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

  private drawArrowHead(g: GameObjects.Graphics, from: { x: number; y: number }, to: { x: number; y: number }) {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const size = 30;
    const point = (a: number, r: number) => ({ x: to.x + Math.cos(angle + a) * r, y: to.y + Math.sin(angle + a) * r });
    const tip = point(0, size * 0.6);
    const left = point(Math.PI * 0.8, size);
    const right = point(-Math.PI * 0.8, size);
    g.fillStyle(0xffffff, 0.9).fillTriangle(tip.x, tip.y, left.x, left.y, right.x, right.y);
  }

  /** The movement is done: shout the spell and fire it at the witch. */
  private castSpell() {
    const spell = this.spell;
    if (!spell) return;
    this.spell = undefined;
    this.tweens.add({ targets: spell.view, alpha: 0, scale: 1.15, duration: 350, onComplete: () => spell.view.destroy() });

    this.shout(spell.def.shout, SPELL_AREA.x, SPELL_AREA.y - SPELL_AREA.size * 0.72 - 60, '#FFD84A');

    const from = { x: this.wandAt.x, y: this.wandAt.y };
    const target = this.witchChest();
    const onHit = () => {
      this.burst(target.x, target.y);
      this.damageWitch(DAMAGE.spell);
      this.time.delayedCall(SPELL.nextDelay, () => this.showNextSpell());
    };

    if (spell.def.effect === 'rabbit') {
      this.patronus(from, target, onHit);
    } else if (spell.def.effect === 'monkeys') {
      this.monkeysAttack(from, target, onHit);
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

  /** Expecto Patronum: a light, see-through rabbit hops from the wand to the witch. */
  private patronus(from: { x: number; y: number }, target: { x: number; y: number }, onHit: () => void) {
    const rabbit = this.add
      .image(from.x, from.y - 80, PATRONUS_KEY)
      .setDepth(DEPTH.projectile)
      .setAlpha(0)
      .setScale(0.2 / RENDER_SCALE);
    const scale = PATRONUS.size / (rabbit.width / RENDER_SCALE) / RENDER_SCALE;
    // It appears out of the wand...
    this.tweens.add({ targets: rabbit, alpha: PATRONUS.alpha, scale, duration: 450, ease: 'Back.Out' });
    // ...and hops to the witch in a few big jumps, leaving a trail of light.
    const trail = this.time.addEvent({ delay: 45, loop: true, callback: () => this.sparkle(rabbit.x, rabbit.y + 60) });
    const start = { x: rabbit.x, y: rabbit.y };
    this.tweens.addCounter({
      from: 0,
      to: 1,
      delay: 350,
      duration: PATRONUS.runTime,
      onUpdate: (t) => {
        const p = t.getValue() ?? 0;
        const hop = Math.abs(Math.sin(p * Math.PI * PATRONUS.hops));
        rabbit.x = start.x + (target.x - start.x) * p;
        rabbit.y = start.y + (target.y - start.y) * p - hop * 90;
        // Squashed a little when it lands, stretched in the air.
        rabbit.setScale(scale * (1 + (hop - 0.5) * 0.08), scale * (1 + (0.5 - hop) * 0.08 + hop * 0.06));
        rabbit.angle = Math.cos(p * Math.PI * PATRONUS.hops) * 8;
      },
      onComplete: () => {
        trail.remove();
        onHit();
        // It fades away in the light.
        this.tweens.add({ targets: rabbit, alpha: 0, scale: scale * 1.4, duration: 400, onComplete: () => rabbit.destroy() });
      },
    });
  }

  /** The Golden Cap spell: flying monkeys fly at the witch, one after the other. */
  private monkeysAttack(from: { x: number; y: number }, target: { x: number; y: number }, onHit: () => void) {
    for (let i = 0; i < MONKEY_SPELL.count; i++) {
      this.time.delayedCall(i * MONKEY_SPELL.gap, () => {
        const start = { x: from.x + PMath.Between(-60, 60), y: from.y - 80 - i * 50 };
        const end = { x: target.x + PMath.Between(-90, 90), y: target.y + PMath.Between(-150, 100) };
        const monkey = this.add.image(start.x, start.y, 'fantasy-monkey').setDepth(DEPTH.projectile);
        const scale = MONKEY_SPELL.size / Math.max(monkey.width, monkey.height);
        monkey.setScale(scale).setFlipX(end.x > start.x);
        // Flapping wings while it flies.
        this.tweens.add({ targets: monkey, scaleY: scale * 0.88, duration: 110, yoyo: true, repeat: -1 });
        this.flyArc(monkey, start, end, 140, 800, () => {
          this.burst(monkey.x, monkey.y);
          monkey.destroy();
          // The witch is hit when the last monkey arrives.
          if (i === MONKEY_SPELL.count - 1) onHit();
        });
      });
    }
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
    const marker = this.add.graphics().setDepth(DEPTH.marker).setPosition(target.x, target.y);
    marker.fillStyle(0xd23636, 0.25).fillEllipse(0, 0, 220, 90).lineStyle(6, 0xd23636, 0.9).strokeEllipse(0, 0, 220, 90);
    this.tweens.add({ targets: marker, scale: { from: 0.85, to: 1.1 }, duration: 400, yoyo: true, repeat: -1 });

    const key = kind === 'monkey' ? 'fantasy-monkey' : 'fantasy-potion';
    const sprite = this.add.image(from.x, from.y, key).setDepth(DEPTH.projectile);
    const size = kind === 'monkey' ? ATTACK.monkeySize : ATTACK.potionSize;
    const fullScale = size / Math.max(sprite.width, sprite.height);
    // The monkey looks to the left in the drawing: flip it when it flies to the right.
    if (kind === 'monkey') sprite.setFlipX(target.x > from.x);

    const attack: Attack = { kind, sprite, marker, tween: undefined, blocked: false };
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
        if (p > ATTACK.blockFrom && this.umbrellaBlocks(sprite.x, sprite.y)) this.bounceBack(attack);
      },
      onComplete: () => {
        if (!attack.blocked) this.attackLands(attack);
      },
    });
  }

  /** Is the open umbrella in the way at this point? */
  private umbrellaBlocks(x: number, y: number) {
    return this.isUmbrellaOpen && PMath.Distance.Between(x, y, this.umbrellaAt.x, this.umbrellaAt.y) < ATTACK.blockRadius;
  }

  /** Player 1 caught it with the umbrella: it bounces back to the witch. */
  private bounceBack(attack: Attack) {
    attack.blocked = true;
    attack.tween?.remove();
    attack.marker.destroy();
    this.shout('Teruggekaatst!', attack.sprite.x, attack.sprite.y - 120, '#A8E4F0');

    // The umbrella gets a little push.
    this.tweens.add({ targets: this.umbrellaOpen, angle: { from: -12, to: 0 }, duration: 500, ease: 'Elastic.Out' });

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
    if (this.state === 'playing') this.shout('Hihihi!', WITCH.x, WITCH.bottomY - 800, '#C9A8FF');
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

  /** The closed book appears where the witch was. A button press (or click) opens it. */
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

    // "Open the book": blinking text below it.
    this.time.delayedCall(BOOK.readyDelay, () => {
      this.bookHint = this.add
        .text(GAME_WIDTH / 2, BOOK.hintY, 'druk op een knop om het boek te openen', {
          fontFamily: 'Oswald',
          fontStyle: '500',
          fontSize: '34px',
          color: '#FFFFFF',
          resolution: RENDER_SCALE,
        })
        .setOrigin(0.5)
        .setDepth(DEPTH.book)
        .setAlpha(0);
      this.tweens.add({ targets: this.bookHint, alpha: { from: 0.25, to: 1 }, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      this.state = 'bookReady';
    });
  }

  /** Dark background, and the book opens big in the middle (like at the end of geschiedenis). */
  private openBook() {
    this.state = 'done';
    this.bookSparkles?.remove();
    this.bookHint?.destroy();
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
    if (!this.textures.exists(PATRONUS_KEY)) {
      // A glowing rabbit face (seen from the front), light blue and a bit see-through.
      const size = 300 * RENDER_SCALE;
      const texture = this.textures.createCanvas(PATRONUS_KEY, size, size);
      const ctx = texture?.getContext();
      if (texture && ctx) {
        ctx.scale(size / 300, size / 300);
        ctx.shadowColor = '#7FD8FF';
        ctx.shadowBlur = 24;
        ctx.fillStyle = '#E4F6FF';
        // Long ears, a round head and chubby cheeks.
        const ellipse = (x: number, y: number, rx: number, ry: number, angle = 0) => {
          ctx.beginPath();
          ctx.ellipse(x, y, rx, ry, angle, 0, Math.PI * 2);
          ctx.fill();
        };
        ellipse(112, 82, 26, 72, -0.22);
        ellipse(188, 82, 26, 72, 0.22);
        ellipse(150, 182, 82, 74);
        ellipse(118, 220, 46, 36);
        ellipse(182, 220, 46, 36);
        // Inside of the ears: a little lighter.
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#B9E8FF';
        ellipse(113, 88, 12, 50, -0.22);
        ellipse(187, 88, 12, 50, 0.22);
        // Eyes, nose and mouth are cut out, so you see through them.
        ctx.globalCompositeOperation = 'destination-out';
        ellipse(120, 172, 11, 14);
        ellipse(180, 172, 11, 14);
        ctx.beginPath();
        ctx.moveTo(138, 204);
        ctx.lineTo(162, 204);
        ctx.lineTo(150, 216);
        ctx.closePath();
        ctx.fill();
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(150, 216);
        ctx.lineTo(150, 228);
        ctx.quadraticCurveTo(140, 240, 130, 232);
        ctx.moveTo(150, 228);
        ctx.quadraticCurveTo(160, 240, 170, 232);
        ctx.stroke();
        // Whiskers, sticking out next to the cheeks.
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = '#E4F6FF';
        ctx.shadowBlur = 10;
        ctx.lineWidth = 4;
        ctx.beginPath();
        for (const side of [-1, 1]) {
          for (const dy of [-10, 6]) {
            ctx.moveTo(150 + side * 70, 214 + dy);
            ctx.lineTo(150 + side * 128, 206 + dy * 2);
          }
        }
        ctx.stroke();
        texture.refresh();
      }
    }
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
  private shout(text: string, x: number, y: number, color: string) {
    // Text of more lines (a long spell) is a bit smaller.
    const lines = text.split('\n').length;
    const label = this.add
      .text(x, y, text, {
        fontFamily: 'Oswald',
        fontStyle: '700',
        fontSize: lines > 1 ? '46px' : '56px',
        color,
        align: 'center',
        resolution: RENDER_SCALE,
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.shout);
    // Always fully on screen.
    label.x = PMath.Clamp(x, label.width / 2 + 20, GAME_WIDTH - label.width / 2 - 20);
    label.y = Math.max(y, label.height / 2 + 20);
    this.tweens.add({ targets: label, scale: { from: 0, to: 1 }, duration: 400, ease: 'Back.Out' });
    this.tweens.add({
      targets: label,
      y: label.y - 70,
      alpha: 0,
      delay: 900 + (lines - 1) * 600,
      duration: 500,
      onComplete: () => label.destroy(),
    });
  }

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
   * Cartoon "poef": clouds pop up one after the other (with a POEF! and stars),
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
    this.shout('POEF!', x, y - 40, '#5B3FA0');

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
