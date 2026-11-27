import { GameObjects, Geom, Input, Math as PMath, Scene, Tweens, type Types } from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE, setupCamera } from '../config';
import { inputManager } from '../input/InputManager';
import { addHandImage, PlayerPointers } from '../playerPointers';
import { dropIn, popIn, riseIn, sinkOut, slideIn, sway, swing } from '../puppet';
import { loadSvgParts } from '../svgParts';
import { addStartButton, preloadStartButton } from '../ui';

/*
 * Minigame "detectieve".
 *
 *  0. Title: "DETECTIEVE" with the letters falling in one by one, then the
 *     net and the magnifying glass come in.
 *  1. Intro: the title shrinks to the top, the tools move to their player's
 *     card, and the cards and the sign come up. A button press starts the game.
 *  2. Search (both at the same time):
 *     - Player 1 (magnifying glass) finds the 3 clues in and around the
 *       bookcases: the glass on a clue makes it grow a bit, a click takes it.
 *       The notebook in the corner then comes up and the clue goes in it.
 *     - Player 2 (net) catches the 4 suspects that walk past, behind or in
 *       front of the bookcases, or peek out next to one (click while the net
 *       is on them). Caught = to a row at the bottom.
 *  3. Accusation: the 4 suspects in a row and the notebook with the clues.
 *     Click on the one you think is the thief. Wrong = try again.
 *  4. The thief (the man with the bowler hat) drops the stolen book.
 *
 * Controls: player 1 = controller, player 2 = mouse/trackpad. Without a
 * controller both tools follow the mouse, so one person can test it.
 */

const PATH = 'assets/minigame-detectieve/';

// ---------------------------------------------------------------------------
// Layout (game coordinates) — tweak to move things around
// ---------------------------------------------------------------------------

/** Center of the letters of "DETECTIEVE" inside detectieve.svg (in SVG pixels). */
const TITLE_SVG_CENTER = { x: 933, y: 370 };
/** The title on the title screen (in the intro it goes away). */
const TITLE_BIG = { x: 965, y: 588, scale: 0.89 };
/** Time between two letters falling in. */
const TITLE_LETTER_DELAY = 70;
/** The title goes on to the intro by itself after this many ms (a button press goes on sooner). */
const TITLE_TIME = 4500;

/** Where the net (player 2) and the magnifying glass (player 1) are; width = size on screen. */
const TOOL_SPOTS = {
  title: { net: { x: 234, y: 406, width: 370 }, glass: { x: 1444, y: 801, width: 268 } },
  // Next to their player's card: glass (player 1) left, net (player 2) right.
  intro: { net: { x: 1205, y: 640, width: 420 }, glass: { x: 640, y: 655, width: 268 } },
};

/** Cards stand with the end of their stick below the screen. */
const BOTTOM_Y = GAME_HEIGHT + 40;
const CARDS = {
  p1: { key: 'dt-card-p1', file: 'speler1-stap1.svg', x: 395, scale: 0.885 },
  p2: { key: 'dt-card-p2', file: 'speler2-stap1.svg', x: 1525, scale: 0.885 },
};
/** The "Help!" sign hangs from the top (its post goes up off the screen). */
const SIGN = { key: 'dt-sign-help', file: 'sign-help.svg', x: GAME_WIDTH / 2, y: -20, scale: 0.87 };
/** "Druk op een knop om te starten", at the bottom between the cards. */
const START_BUTTON = { x: GAME_WIDTH / 2, y: 1140, width: 755 };

/** Draw order (higher = on top). */
// The net and magnifying glass are in front of the cards.
const DEPTH = {
  background: 0,
  bookcase: 2,
  clue: 3,
  suspect: 4,
  content: 5,
  tools: 6,
  caught: 7,
  backButton: 10,
  overlay: 20,
  notebook: 21,
  message: 25,
  cursorTool: 30,
};

// ---------------------------------------------------------------------------
// The game
// ---------------------------------------------------------------------------

/** The two bookcases: center and height on screen. */
const BOOKCASES = [
  { key: 'dt-case-l', file: 'boekenkast L.svg', x: 546, y: 612, height: 1063 },
  { key: 'dt-case-r', file: 'boekenkast R.svg', x: 1388, y: 612, height: 1063 },
];

type ClueId = 'footprints' | 'cloth' | 'moustache';

/** The clues: where they are hidden (center, width on screen) and their line in the notebook. */
const CLUES: { id: ClueId; key: string; file: string; x: number; y: number; width: number; tipKey: string; tipFile: string }[] = [
  { id: 'cloth', key: 'dt-clue-cloth', file: 'stukje-textiel.svg', x: 738, y: 160, width: 185, tipKey: 'dt-tip-cloth', tipFile: 'stof-tip.svg' },
  { id: 'footprints', key: 'dt-clue-footprints', file: 'voetstappen.svg', x: 430, y: 1200, width: 430, tipKey: 'dt-tip-footprints', tipFile: 'voetafdruk-tip.svg' },
  { id: 'moustache', key: 'dt-clue-moustache', file: 'kamensnorwax.svg', x: 1580, y: 726, width: 165, tipKey: 'dt-tip-moustache', tipFile: 'snor-tip.svg' },
];

/**
 * Clues are hidden: they only show under the magnifying glass.
 * reveal = how close (px from the clue's edge) it is fully visible / not visible at all.
 * distance = glass this close: it grows a little and a click finds it.
 */
const CLUE_HOVER = { distance: 20, grow: 1.15, reveal: { full: 30, none: 160 } };

/**
 * The suspects. `quote` = shown when he is pointed out (no quote yet = only "FOUT!").
 * `clues` = which clues fit him (for later); the thief fits all three.
 */
const SUSPECTS: {
  key: string;
  file: string;
  height: number;
  thief?: boolean;
  quote?: string;
  clues: Record<ClueId, boolean>;
}[] = [
  { key: 'dt-moriarty', file: 'professor-moriarty.svg', height: 568, clues: { footprints: true, cloth: false, moustache: false } },
  { key: 'dt-wolf', file: 'wolf.svg', height: 490, quote: 'quote-wolf.svg', clues: { footprints: false, cloth: false, moustache: false } },
  { key: 'dt-bowler', file: 'man-bolhoed.svg', height: 545, thief: true, quote: 'quote-emil.svg', clues: { footprints: true, cloth: true, moustache: true } },
  { key: 'dt-hook', file: 'kapitein-haak.svg', height: 545, quote: 'quote-haak.svg', clues: { footprints: true, cloth: false, moustache: true } },
];

/**
 * Wrong suspect: "FOUT!" next to his head and his quote over his legs.
 * Positions are fractions of the suspect's height, from his top / center.
 */
const WRONG = { foutWidth: 200, foutX: 0.18, foutY: 0.02, quoteWidth: 470, quoteY: 0.72, time: 3000 };

/**
 * Accusation with two players: both have to click the same suspect. A player's choice shows as
 * their hand (pointing down) above that suspect's head: height, how far left (player 1) or
 * right (player 2) of the middle, and how far above the head (game pixels).
 */
const CHOICE_HAND = { height: 90, dx: 34, aboveHead: 55 };

/** The end: the thief big on the left with his quote, the "Proficiat!" sign on the right. */
const ENDING = {
  thief: { x: 380, y: 1160, height: 930 },
  quote: { x: 840, y: 280, width: 610 },
  sign: { key: 'dt-sign-proficiat', file: 'sign-proficiat.svg', x: 1410, bottomY: GAME_HEIGHT + 60, width: 780 },
  /** Time before the thief drops the book (ms). */
  bookDelay: 2200,
};

/**
 * Suspects in the library (search). Each time one appears, he does one of these:
 * walk in front of the bookcases, walk behind them, walk diagonally from the
 * back to the front, or peek out next to a bookcase.
 * front/back = feet line and height on screen; time = to cross the screen (ms).
 */
const WALK = {
  front: { y: 1270, height: 680 },
  back: { y: 1150, height: 620 },
  time: 8000,
  /** Now and then one hurries past, to make it extra hard: chance (0..1) and its time (ms). */
  fastChance: 0.25,
  fastTime: 2600,
  peekTime: 1800,
  pause: 1300,
};
/**
 * Caught suspects go on the "Verdachtes" sign on the left. It is folded away
 * (only the label sticks out) and folds out each time someone is caught.
 * Fractions are of the sign image (699 x 888).
 */
const SUSPECT_SIGN = {
  key: 'dt-sign-suspects',
  file: 'verdachtes-sign.svg',
  width: 699,
  height: 888,
  /**
   * Left edge of the sign image on screen when open (negative = partly off screen,
   * so only a bit of the post shows), its top, and its size.
   * foldedOffset = how far it slides further left when folded away (fraction of its width).
   */
  x: -205,
  y: 110,
  scale: 0.84,
  foldedOffset: 0.5,
  /** How long it stays open after a catch (ms). */
  openTime: 1800,
  /** The silhouettes: center of each slot, its height, and the board colour behind them. */
  slots: {
    'dt-hook': { x: 0.63, y: 0.2 },
    'dt-wolf': { x: 0.63, y: 0.385 },
    'dt-moriarty': { x: 0.63, y: 0.585 },
    'dt-bowler': { x: 0.63, y: 0.795 },
  } as Record<string, { x: number; y: number }>,
  slotWidth: 0.27,
  slotHeight: 0.19,
  board: 0x743e21,
};

/** Notebook (search): small in the corner, or big in front. Fractions are of the notebook image. */
const NOTEBOOK = {
  key: 'dt-notebook',
  file: 'notitieboekje.svg',
  width: 578,
  height: 860,
  /** In the corner: only the top shows. When a clue is found it comes up a bit, to the new line. */
  corner: { x: 1628, y: 1356, scale: 0.83, angle: -3 },
  /** How much of the notebook shows below the new line when it comes up (px). */
  upMargin: 120,
  /** Centers of the three slots and the width of a clue line. */
  slots: [0.38, 0.61, 0.83].map((y) => ({ x: 0.56, y })),
  tipWidth: 0.62,
  /** The "0/3" in the image, covered and replaced by the real count. */
  counter: { x: 0.835, y: 0.19, width: 0.13, height: 0.05 },
  paper: 0xe8d5cc,
};

/** Explanation cards that show once during the search (on a stick, from the bottom). */
const SEARCH_CARDS = {
  p1: { key: 'dt-card-p1-clue', file: 'speler1-stap2.svg', x: 300, scale: 0.85 },
  p2: { key: 'dt-card-p2-catch', file: 'speler2-stap2.svg', x: 830, scale: 0.85 },
};
/** A search card goes away after this long (ms), or when the player does it. */
const SEARCH_CARD_TIME = 5000;

/** Accusation: the suspects in a row (x = center, feet at y). */
const LINEUP = { xs: [239, 632, 1133, 1604], y: 990 };
/** The sign hangs from the top: its post is partly above the screen. */
const ACCUSE_SIGN = { key: 'dt-sign2', file: 'sign2.svg', y: -235, scale: 0.9 };
const NOTEBOOK_ROW = { key: 'dt-notebook-row', file: 'notitieboek-horizontaal.svg', y: 1059, width: 1818 };

/** The tools as cursors: width on screen, and the point (fraction of the image) that is the cursor. */
const GLASS_TOOL = { width: 340, originX: 0.36, originY: 0.33 };
const NET_TOOL = { width: 380, originX: 0.55, originY: 0.28 };

type State =
  | 'title'
  | 'titleReady'
  | 'busy'
  | 'intro'
  | 'introReady'
  | 'search'
  | 'notebook'
  | 'accuse'
  | 'done';

interface ClueState {
  def: (typeof CLUES)[number];
  image: GameObjects.Image;
  found: boolean;
}

interface SuspectState {
  def: (typeof SUSPECTS)[number];
  image: GameObjects.Image;
  caught: boolean;
  walk?: Tweens.Tween;
  /** Search: is he behind a bookcase right now (then a click on the bookcase doesn't catch him)? */
  behind?: boolean;
}

export class DetectiveScene extends Scene {
  private state: State = 'title';
  private letters: { image: GameObjects.Image; svgX: number; svgY: number }[] = [];
  private net?: GameObjects.Image;
  private glass?: GameObjects.Image;
  private pointers!: PlayerPointers;
  /** Everything of the title and intro, to clear away when the game starts. */
  private introObjects: GameObjects.GameObject[] = [];

  // Game
  private glassTool?: GameObjects.Image;
  private netTool?: GameObjects.Image;
  private overlay?: GameObjects.Rectangle;
  private searchObjects: GameObjects.GameObject[] = [];
  private clues: ClueState[] = [];
  private suspects: SuspectState[] = [];
  private walkQueue: SuspectState[] = [];
  private walking?: SuspectState;
  private notebook?: GameObjects.Container;
  /** The clue under the magnifying glass (search). */
  private hoverClue?: ClueState;
  /** Search cards: shown once each; the one that is up now. */
  private seenSearchCard = { p1: false, p2: false };
  private searchCard: Partial<Record<'p1' | 'p2', GameObjects.Image>> = {};
  private notebookCount?: GameObjects.Text;
  private foundCount = 0;
  private caughtCount = 0;
  /** The "Verdachtes" sign (search) and the timer that folds it away again. */
  private suspectSign?: GameObjects.Container;
  private foldTimer?: Phaser.Time.TimerEvent;
  /** Accusation: the check/cross marks on the horizontal notebook (live, for the suspect under the glass). */
  /** Accusation: the sign and notebook, and the "FOUT!" + quote of a wrong suspect. */
  private accuseObjects: GameObjects.Image[] = [];
  private wrongObjects: GameObjects.Image[] = [];
  /** Accusation with two players: who chose which suspect, and their hand above it. */
  private accuseChoice: Partial<Record<1 | 2, SuspectState>> = {};
  private choiceHands: Partial<Record<1 | 2, GameObjects.Container>> = {};

  constructor() {
    super('DetectiveScene');
  }

  preload() {
    this.load.image('dt-background', PATH + 'background.png');
    this.load.svg('dt-net', PATH + 'net.svg', { scale: RENDER_SCALE });
    this.load.svg('dt-glass', PATH + 'vergrootglas.svg', { scale: RENDER_SCALE });
    this.load.svg(SIGN.key, PATH + SIGN.file, { scale: RENDER_SCALE });
    preloadStartButton(this);
    Object.values(CARDS).forEach((card) => this.load.svg(card.key, PATH + card.file, { scale: RENDER_SCALE }));
    // Loaded as text: split into one image per letter (see svgParts.ts).
    this.load.text('dt-title', PATH + 'detectieve.svg');
    // Shared with the geschiedenis game.
    this.load.image('dt-back', 'assets/minigame-geschiedenis/back-button.png');
    PlayerPointers.preload(this);

    // Game
    const svg = (key: string, file: string) => this.load.svg(key, PATH + file, { scale: RENDER_SCALE });
    BOOKCASES.forEach((c) => svg(c.key, c.file));
    CLUES.forEach((c) => {
      svg(c.key, c.file);
      svg(c.tipKey, c.tipFile);
    });
    SUSPECTS.forEach((c) => svg(c.key, c.file));
    svg(NOTEBOOK.key, NOTEBOOK.file);
    svg(SUSPECT_SIGN.key, SUSPECT_SIGN.file);
    Object.values(SEARCH_CARDS).forEach((c) => svg(c.key, c.file));
    svg(NOTEBOOK_ROW.key, NOTEBOOK_ROW.file);
    svg(ACCUSE_SIGN.key, ACCUSE_SIGN.file);
    svg('dt-fout', 'fout.svg');
    svg(ENDING.sign.key, ENDING.sign.file);
    SUSPECTS.forEach((c) => c.quote && svg(quoteKey(c.key), c.quote));
    // The stolen book (the same as in the menu).
    this.load.svg('dt-stolen-book', 'assets/menu/book.svg', { scale: RENDER_SCALE });
    // The open book at the end (the same as in the geschiedenis game).
    this.load.image('dt-book-open', 'assets/minigame-geschiedenis/book-1.png');
  }

  create() {
    setupCamera(this);
    // Fade in from black (the menu fades out to black).
    this.cameras.main.fadeIn(600, 0, 0, 0);
    // Input is switched off while leaving the scene; switch it back on.
    this.input.enabled = true;
    // (The controllers are calibrated on the explanation screen, see showIntro.)

    this.state = 'title';
    this.letters = [];
    this.net = undefined;
    this.glass = undefined;
    this.introObjects = [];
    this.glassTool = undefined;
    this.netTool = undefined;
    this.overlay = undefined;
    this.searchObjects = [];
    this.clues = [];
    this.suspects = [];
    this.walkQueue = [];
    this.walking = undefined;
    this.notebook = undefined;
    this.notebookCount = undefined;
    this.foundCount = 0;
    this.caughtCount = 0;
    this.suspectSign = undefined;
    this.foldTimer = undefined;
    this.accuseObjects = [];
    this.wrongObjects = [];
    this.accuseChoice = {};
    this.choiceHands = {};
    this.hoverClue = undefined;
    this.seenSearchCard = { p1: false, p2: false };
    this.searchCard = {};

    this.add.image(0, 0, 'dt-background').setOrigin(0).setDisplaySize(GAME_WIDTH, GAME_HEIGHT).setDepth(DEPTH.background);

    // The players' hands as the cursor.
    this.pointers = new PlayerPointers(this);
    this.pointers.show();
    // Title and explanation: both players' hands (player 1 controller, player 2 mouse).
    inputManager.setSplit(this);

    this.addBackButton();

    this.input.on('pointerup', this.pressButton, this);
    // Clicks with player and position (net throws), from the input manager.
    inputManager.on('select', this.onSelect, this);
    this.events.once('shutdown', () => {
      this.input.off('pointerup', this.pressButton, this);
      inputManager.off('select', this.onSelect, this);
    });

    void this.showTitle();
  }

  /** "The button" (mouse click for now, ESP32 button later). */
  private pressButton() {
    if (this.state === 'titleReady') this.showIntro();
    else if (this.state === 'introReady') this.startGame();
  }

  private addBackButton() {
    const button = this.add
      .image(110, 84, 'dt-back')
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
    popIn(this, button, { delay: 300 });
  }

  // ---------------------------------------------------------------------------
  // Title
  // ---------------------------------------------------------------------------

  private async showTitle() {
    const title = await loadSvgParts(this, this.cache.text.get('dt-title'), 'dt-title', RENDER_SCALE);
    // The player may have left the scene while the letters were being prepared.
    if (!this.sys.isActive() || this.state !== 'title') return;

    // Letters fall in one by one, like puppets on a string.
    this.letters = title.parts.map((part, i) => {
      const image = this.add
        .image(this.titleX(part.x, TITLE_BIG), this.titleY(part.y, TITLE_BIG), part.key)
        .setScale(TITLE_BIG.scale / RENDER_SCALE)
        .setDepth(DEPTH.content);
      dropIn(this, image, { delay: 200 + i * TITLE_LETTER_DELAY, distance: 900 });
      return { image, svgX: part.x, svgY: part.y };
    });

    // Then the tools come in. They stay for the intro.
    const toolsDelay = 400 + this.letters.length * TITLE_LETTER_DELAY;
    const { net: n, glass: g } = TOOL_SPOTS.title;
    this.net = this.add.image(n.x, n.y, 'dt-net').setDepth(DEPTH.tools);
    this.net.setScale(n.width / this.net.width);
    this.glass = this.add.image(g.x, g.y, 'dt-glass').setDepth(DEPTH.tools);
    this.glass.setScale(g.width / this.glass.width);
    const net = this.net;
    const glass = this.glass;
    slideIn(this, net, 'left', { delay: toolsDelay, sway: false, onComplete: () => this.netSwish(net) });
    slideIn(this, glass, 'right', { delay: toolsDelay + 150, sway: false, onComplete: () => this.glassCircle(glass) });

    this.time.delayedCall(toolsDelay + 600, () => {
      if (this.state === 'title') this.state = 'titleReady';
    });
    this.time.delayedCall(TITLE_TIME, () => {
      if (this.state === 'titleReady') this.showIntro();
    });
  }

  private titleX(svgX: number, at: { x: number; scale: number }) {
    return at.x + (svgX - TITLE_SVG_CENTER.x) * at.scale;
  }

  private titleY(svgY: number, at: { y: number; scale: number }) {
    return at.y + (svgY - TITLE_SVG_CENTER.y) * at.scale;
  }

  // ---------------------------------------------------------------------------
  // Intro
  // ---------------------------------------------------------------------------

  private showIntro() {
    this.state = 'busy';

    // The title goes down, letter by letter.
    const letters = this.letters;
    this.letters = [];
    letters.forEach(({ image }, i) => sinkOut(this, image, { delay: i * 30, onComplete: () => image.destroy() }));

    // The tools fade away while the players calibrate (so they look at the circle); afterwards
    // they come back next to their player's card.
    const tools = [this.net, this.glass].filter((tool) => tool !== undefined);
    this.tweens.add({ targets: tools, alpha: 0, duration: 300 });

    // The "Help!" sign comes down from the top and hangs still; the cards come up on their sticks.
    const sign = this.add
      .image(SIGN.x, SIGN.y, SIGN.key)
      .setOrigin(0.5, 0)
      .setScale(SIGN.scale / RENDER_SCALE)
      .setDepth(DEPTH.content);
    dropIn(this, sign, { delay: 300, sway: false });
    this.introObjects.push(sign);

    // First the players calibrate their controllers ("point at the circle"); then the cards
    // come up and the game can be started. Without controllers that need it: right away.
    inputManager.calibrateThen(this, () => {
      if (!this.sys.isActive() || this.state !== 'busy') return;
      this.moveTool(this.net, TOOL_SPOTS.intro.net, (net) => this.netSwish(net));
      this.moveTool(this.glass, TOOL_SPOTS.intro.glass, (glass) => this.glassCircle(glass));
      this.tweens.add({ targets: tools, alpha: 1, duration: 400, delay: 300 });
      this.introObjects.push(addStartButton(this, START_BUTTON.x, START_BUTTON.y, { width: START_BUTTON.width, depth: DEPTH.content, delay: 1000 }));
      for (const [i, card] of [CARDS.p1, CARDS.p2].entries()) {
        const image = this.add
          .image(card.x, BOTTOM_Y, card.key)
          .setOrigin(0.5, 1)
          .setScale(card.scale / RENDER_SCALE)
          .setDepth(DEPTH.content);
        riseIn(this, image, { delay: 550 + i * 150, gentle: true });
        this.introObjects.push(image);
      }

      this.time.delayedCall(1400, () => {
        if (this.state === 'busy') this.state = 'introReady';
      });
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
    this.stopCircle(tool);
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

  /** The net swishes back and forth, as if catching something. */
  private netSwish(net: GameObjects.Image) {
    this.tweens.add({ targets: net, angle: { from: -12, to: 14 }, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
  }

  /** The magnifying glass moves around in small circles, searching. */
  private glassCircle(glass: GameObjects.Image) {
    this.stopCircle(glass);
    const cx = glass.x;
    const cy = glass.y;
    const radius = 28;
    const circle = this.tweens.addCounter({
      from: 0,
      to: Math.PI * 2,
      duration: 1800,
      repeat: -1,
      onUpdate: (t) => {
        const a = t.getValue() ?? 0;
        // Starts at its spot (a = 0) and goes round from there.
        glass.setPosition(cx + Math.cos(a) * radius - radius, cy + Math.sin(a) * radius);
      },
    });
    glass.setData('circle', circle);
    glass.once('destroy', () => circle.remove());
  }

  private stopCircle(tool: GameObjects.Image) {
    (tool.getData('circle') as Tweens.Tween | undefined)?.remove();
    tool.setData('circle', undefined);
  }

  // ---------------------------------------------------------------------------
  // Start: clear the intro, build the library
  // ---------------------------------------------------------------------------

  private startGame() {
    this.state = 'busy';

    // The intro goes: title letters, sign and cards down, tools away.
    const leaving: GameObjects.GameObject[] = [...this.letters.map((l) => l.image), ...this.introObjects];
    leaving.forEach((o, i) => sinkOut(this, o as GameObjects.Image, { delay: i * 25, onComplete: () => o.destroy() }));
    for (const tool of [this.glass, this.net]) {
      if (!tool) continue;
      this.stopCircle(tool);
      this.tweens.killTweensOf(tool);
      this.tweens.add({ targets: tool, alpha: 0, scale: tool.scale * 0.6, duration: 300, onComplete: () => tool.destroy() });
    }
    this.letters = [];
    this.introObjects = [];

    this.time.delayedCall(600, () => this.buildSearch());
  }

  /** The tools follow the players: glass = player 1 (controller), net = player 2 (mouse). */
  private addCursorTools() {
    this.glassTool = this.add.image(0, 0, 'dt-glass').setOrigin(GLASS_TOOL.originX, GLASS_TOOL.originY).setDepth(DEPTH.cursorTool);
    this.glassTool.setScale(GLASS_TOOL.width / this.glassTool.width);
    this.netTool = this.add.image(0, 0, 'dt-net').setOrigin(NET_TOOL.originX, NET_TOOL.originY).setDepth(DEPTH.cursorTool);
    this.netTool.setScale(NET_TOOL.width / this.netTool.width);

    // The tools are the cursors now, not the hands.
    this.pointers.hide();
    this.input.setDefaultCursor('none');
  }

  /** Where player 1's glass points: the controller, or the mouse when there is no controller. */
  private glassPoint(): { x: number; y: number } {
    return inputManager.getMode() === 'tilt' ? inputManager.getPlayerCursor(1) : inputManager.getPlayerCursor(2);
  }

  private netPoint(): { x: number; y: number } {
    return inputManager.getPlayerCursor(2);
  }

  private buildSearch() {
    for (const c of BOOKCASES) {
      const image = this.add.image(c.x, c.y, c.key).setDepth(DEPTH.bookcase);
      image.setScale(c.height / image.height);
      riseIn(this, image, { distance: 900, sway: false, overshoot: false });
      this.searchObjects.push(image);
    }

    // Clues: hidden until the magnifying glass is on them.
    this.clues = CLUES.map((def) => {
      const image = this.add.image(def.x, def.y, def.key).setDepth(DEPTH.clue);
      image.setScale(def.width / image.width);
      // Remember the normal size and spot (the clue grows a bit under the glass).
      image.setData('scale', image.scale).setData('bounds', image.getBounds());
      // Hidden until the magnifying glass comes near.
      image.setAlpha(0);
      this.searchObjects.push(image);
      return { def, image, found: false };
    });

    // Suspects: walk through the library in a random order, one at a time.
    this.suspects = PMath.RND.shuffle(SUSPECTS.slice()).map((def) => {
      const image = this.add.image(-1000, WALK.front.y, def.key).setOrigin(0.5, 1).setDepth(DEPTH.suspect).setVisible(false);
      image.setScale(WALK.front.height / image.height);
      return { def, image, caught: false };
    });
    this.walkQueue = this.suspects.slice();

    this.addNotebook();
    this.addSuspectSign();
    this.addCursorTools();

    this.time.delayedCall(1000, () => {
      this.state = 'search';
      this.time.delayedCall(800, () => this.walkNext());
    });
  }

  // ---------------------------------------------------------------------------
  // Every frame
  // ---------------------------------------------------------------------------

  update() {
    if (!this.glassTool || !this.netTool) return;
    const glass = this.glassPoint();
    const net = this.netPoint();
    this.glassTool.setPosition(glass.x, glass.y);
    this.netTool.setPosition(net.x, net.y);

    if (this.state === 'search') this.searchClues(glass);
  }

  // ---------------------------------------------------------------------------
  // Search: clues (player 1)
  // ---------------------------------------------------------------------------

  /**
   * Clues only show under the glass (fading in as it comes near). The clue right
   * under it grows a little (a click by player 1 then finds it).
   */
  private searchClues(glass: { x: number; y: number }) {
    const { full, none } = CLUE_HOVER.reveal;
    let under: ClueState | undefined;
    for (const clue of this.clues) {
      if (clue.found) continue;
      const distance = distanceToRect(glass, clue.image.getData('bounds') as Geom.Rectangle);
      clue.image.setAlpha(PMath.Clamp((none - distance) / (none - full), 0, 1));
      if (distance <= CLUE_HOVER.distance && !under) under = clue;
    }
    if (under === this.hoverClue) return;
    if (under) this.showSearchCard('p1');
    for (const clue of [this.hoverClue, under]) {
      if (!clue || clue.found) continue;
      const base = clue.image.getData('scale') as number;
      this.tweens.killTweensOf(clue.image);
      this.tweens.add({ targets: clue.image, scale: clue === under ? base * CLUE_HOVER.grow : base, duration: 180, ease: 'Sine.Out' });
    }
    this.hoverClue = under;
  }

  /** Player 1 clicks on a clue: it slides into the notebook, which comes to the front. */
  private findClue(clue: ClueState) {
    clue.found = true;
    this.hoverClue = undefined;
    this.foundCount++;
    this.state = 'notebook';
    this.pauseSuspect(true);

    this.hideSearchCard('p1');

    // The notebook comes up in its corner, to the next empty line.
    const notebook = this.notebook!;
    const slot = NOTEBOOK.slots[this.foundCount - 1];
    const local = { x: (slot.x - 0.5) * NOTEBOOK.width, y: (slot.y - 0.5) * NOTEBOOK.height };
    const { scale } = NOTEBOOK.corner;
    const upY = Math.min(NOTEBOOK.corner.y, GAME_HEIGHT - NOTEBOOK.upMargin - local.y * scale);
    this.tweens.add({ targets: notebook, y: upY, angle: 0, duration: 500, ease: 'Back.Out' });

    // The clue slides into that line...
    this.tweens.killTweensOf(clue.image);
    clue.image.setDepth(DEPTH.notebook + 1);
    this.tweens.add({
      targets: clue.image,
      x: NOTEBOOK.corner.x + local.x * scale - 90,
      y: upY + local.y * scale,
      scale: (clue.image.getData('scale') as number) * 0.6,
      angle: -6,
      duration: 750,
      ease: 'Cubic.InOut',
      onComplete: () => {
        // ...and becomes the line in the notebook; the count goes up.
        this.tweens.add({ targets: clue.image, alpha: 0, duration: 200 });
        const tip = this.add.image(local.x, local.y, clue.def.tipKey);
        tip.setScale((NOTEBOOK.tipWidth * NOTEBOOK.width) / tip.width);
        notebook.add(tip);
        popIn(this, tip);
        this.notebookCount?.setText(`${this.foundCount}/3`);
      },
    });

    // Back down, and on with the game.
    this.time.delayedCall(2300, () => {
      this.tweens.add({ targets: notebook, ...NOTEBOOK.corner, duration: 500, ease: 'Cubic.InOut' });
      this.time.delayedCall(500, () => {
        this.state = 'search';
        this.pauseSuspect(false);
        this.checkSearchDone();
      });
    });
  }

  /** An explanation card for the search, the first time only. */
  private showSearchCard(player: 'p1' | 'p2') {
    if (this.seenSearchCard[player]) return;
    this.seenSearchCard[player] = true;
    const def = SEARCH_CARDS[player];
    const card = this.add
      .image(def.x, BOTTOM_Y, def.key)
      .setOrigin(0.5, 1)
      .setScale(def.scale / RENDER_SCALE)
      .setDepth(DEPTH.notebook - 1);
    riseIn(this, card, { gentle: true });
    this.searchCard[player] = card;
    this.time.delayedCall(SEARCH_CARD_TIME, () => this.hideSearchCard(player));
  }

  private hideSearchCard(player: 'p1' | 'p2') {
    const card = this.searchCard[player];
    if (!card) return;
    this.searchCard[player] = undefined;
    sinkOut(this, card, { onComplete: () => card.destroy() });
  }

  private addNotebook() {
    const image = this.add.image(0, 0, NOTEBOOK.key);
    image.setScale(NOTEBOOK.width / image.width);
    // Cover the "0/3" in the drawing and write the real count there.
    const c = NOTEBOOK.counter;
    const cover = this.add.rectangle(
      (c.x - 0.5) * NOTEBOOK.width,
      (c.y - 0.5) * NOTEBOOK.height,
      c.width * NOTEBOOK.width,
      c.height * NOTEBOOK.height,
      NOTEBOOK.paper,
    );
    this.notebookCount = this.add
      .text(cover.x, cover.y, '0/3', {
        fontFamily: 'Georgia, serif',
        fontStyle: 'italic',
        fontSize: '28px',
        color: '#111111',
        resolution: RENDER_SCALE * 2,
      })
      .setOrigin(0.5);
    const { x, y, scale, angle } = NOTEBOOK.corner;
    this.notebook = this.add
      .container(x, y + 400, [image, cover, this.notebookCount])
      .setScale(scale)
      .setAngle(angle)
      .setDepth(DEPTH.notebook);
    this.tweens.add({ targets: this.notebook, y, delay: 500, duration: 600, ease: 'Back.Out' });
  }

  // ---------------------------------------------------------------------------
  // Search: suspects (player 2)
  // ---------------------------------------------------------------------------

  /** The next suspect shows up somewhere in the library. */
  private walkNext() {
    if (this.state !== 'search' && this.state !== 'notebook') return;
    const suspect = this.walkQueue.shift();
    if (!suspect) return;
    this.walking = suspect;
    const { image } = suspect;
    this.tweens.killTweensOf(image);
    image.setVisible(true).setAngle(0).setAlpha(1);

    this.showSearchCard('p2');
    const kind = PMath.RND.pick(['front', 'behind', 'diagonal', 'peek'] as const);
    if (kind === 'peek') this.peek(suspect);
    else this.walkAcross(suspect, kind);
  }

  /** Walk across the library: in front of the bookcases, behind them, or from the back to the front. */
  private walkAcross(suspect: SuspectState, kind: 'front' | 'behind' | 'diagonal') {
    const { image } = suspect;
    const fromLeft = Math.random() < 0.5;
    const margin = 300;
    const from = kind === 'front' ? WALK.front : WALK.back;
    const to = kind === 'behind' ? WALK.back : WALK.front;
    const scaleFor = (h: number) => h / image.height;

    image.setPosition(fromLeft ? -margin : GAME_WIDTH + margin, from.y).setScale(scaleFor(from.height));
    // Look the way he walks (the drawings look to the right).
    image.setFlipX(!fromLeft);
    this.setBehind(suspect, kind !== 'front');

    // Sometimes he hurries past (faster steps too).
    const fast = Math.random() < WALK.fastChance;
    // A little bounce in each step.
    this.tweens.add({ targets: image, angle: { from: -3, to: 3 }, duration: fast ? 120 : 260, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    this.tweens.add({
      targets: image,
      x: fromLeft ? GAME_WIDTH + margin : -margin,
      y: to.y,
      scale: scaleFor(to.height),
      duration: fast ? WALK.fastTime : WALK.time,
      ease: 'Linear',
      onUpdate: (tween) => {
        // Diagonal: comes out from behind the bookcases halfway.
        if (kind === 'diagonal') this.setBehind(suspect, tween.progress < 0.45);
      },
      onComplete: () => this.suspectGone(suspect),
    });
  }

  /** Peek out next to a bookcase, leaning a bit, and duck back. */
  private peek(suspect: SuspectState) {
    const { image } = suspect;
    const caseDef = PMath.RND.pick(BOOKCASES);
    const caseWidth = (caseDef.height * 855) / 1284;
    const side = Math.random() < 0.5 ? -1 : 1;
    const edge = caseDef.x + side * (caseWidth / 2);
    image.setScale(WALK.back.height / image.height).setFlipX(side < 0);
    const width = image.displayWidth;
    // Starts hidden behind the bookcase, then leans out about half his width.
    image.setPosition(edge - side * (width / 2 + 20), WALK.back.y);
    this.setBehind(suspect, true);
    this.tweens.add({
      targets: image,
      x: edge + side * (width * 0.05),
      angle: side * 8,
      duration: 500,
      ease: 'Back.Out',
      hold: WALK.peekTime,
      yoyo: true,
      onComplete: () => this.suspectGone(suspect),
    });
  }

  /** Behind a bookcase or in front of it. */
  private setBehind(suspect: SuspectState, behind: boolean) {
    if (suspect.behind === behind) return;
    suspect.behind = behind;
    suspect.image.setDepth(behind ? DEPTH.bookcase - 1 : DEPTH.suspect);
  }

  /** Not caught: he goes, and comes back later. */
  private suspectGone(suspect: SuspectState) {
    this.tweens.killTweensOf(suspect.image);
    suspect.image.setVisible(false);
    if (this.walking === suspect) this.walking = undefined;
    this.walkQueue.push(suspect);
    this.time.delayedCall(WALK.pause, () => this.walkNext());
  }

  /** Stop / go on with the suspect's movement (while the notebook is open). */
  private pauseSuspect(pause: boolean) {
    const image = this.walking?.image;
    if (!image) return;
    for (const tween of this.tweens.getTweensOf(image)) {
      if (pause) tween.pause();
      else tween.resume();
    }
  }

  /**
   * A click. Player 1 (controller button) finds the clue under the glass;
   * player 2 (mouse) throws the net. Without a controller, the mouse does both.
   */
  private onSelect(event: { x: number; y: number; player?: number }) {
    const controller = inputManager.getMode() === 'tilt';
    const isPlayer1 = event.player === 1;

    if (this.state === 'search') {
      if ((isPlayer1 || !controller) && this.hoverClue) {
        this.findClue(this.hoverClue);
        return;
      }
      if (!isPlayer1) this.tryCatch(this.netPoint());
    } else if (this.state === 'accuse') {
      // Either player: a click on the suspect, at their own hand.
      this.tryAccuse(isPlayer1 ? this.glassPoint() : this.netPoint(), isPlayer1 ? 1 : 2);
    }
  }

  private throwNet() {
    if (!this.netTool) return;
    this.tweens.add({ targets: this.netTool, angle: { from: 0, to: -35 }, duration: 120, yoyo: true, ease: 'Quad.Out' });
  }

  private tryCatch(point: { x: number; y: number }) {
    this.throwNet();
    const suspect = this.walking;
    if (!suspect || !suspect.image.getBounds().contains(point.x, point.y)) return;
    // Behind a bookcase: only the part next to it counts, not the bookcase itself.
    if (suspect.behind && this.bookcaseImages().some((b) => b.getBounds().contains(point.x, point.y))) return;

    // Caught! The sign folds out and he goes into his slot on it.
    this.hideSearchCard('p2');
    suspect.caught = true;
    this.tweens.killTweensOf(suspect.image);
    this.walking = undefined;
    this.caughtCount++;
    const { image } = suspect;
    image.setDepth(DEPTH.caught + 1).setFlipX(false);
    suspect.behind = false;

    this.openSuspectSign();
    const slot = this.suspectSlot(suspect.def.key);
    const height = SUSPECT_SIGN.slotHeight * SUSPECT_SIGN.height * SUSPECT_SIGN.scale;
    this.tweens.add({
      targets: image,
      x: slot.x,
      // The image's origin is at his feet.
      y: slot.y + height / 2,
      scale: height / image.height,
      angle: 0,
      duration: 750,
      delay: 200,
      ease: 'Cubic.InOut',
      onComplete: () => {
        // He becomes part of the sign (in colour, over his silhouette).
        image.setVisible(false);
        this.fillSlot(suspect.def.key);
        this.checkSearchDone();
      },
    });
    this.time.delayedCall(WALK.pause, () => this.walkNext());
  }

  /** The "Verdachtes" sign on the left: folded away, only the label sticks out. */
  private addSuspectSign() {
    const S = SUSPECT_SIGN;
    const image = this.add.image(0, 0, S.key).setOrigin(0, 0);
    image.setScale(S.width / image.width);
    this.suspectSign = this.add
      .container(-S.width * S.scale, S.y, [image])
      .setScale(S.scale)
      .setDepth(DEPTH.caught);
    // Slides in, folded away.
    this.tweens.add({ targets: this.suspectSign, x: this.foldedX(), delay: 700, duration: 600, ease: 'Back.Out' });
    this.searchObjects.push(this.suspectSign);
  }

  private foldedX(): number {
    return SUSPECT_SIGN.x - SUSPECT_SIGN.foldedOffset * SUSPECT_SIGN.width * SUSPECT_SIGN.scale;
  }

  /** Fold the sign out, and fold it away again a moment after the last catch. */
  private openSuspectSign() {
    const sign = this.suspectSign;
    if (!sign) return;
    this.tweens.killTweensOf(sign);
    this.tweens.add({ targets: sign, x: SUSPECT_SIGN.x, duration: 400, ease: 'Back.Out' });
    this.foldTimer?.remove();
    this.foldTimer = this.time.delayedCall(SUSPECT_SIGN.openTime + 950, () => {
      this.tweens.add({ targets: sign, x: this.foldedX(), duration: 450, ease: 'Cubic.In' });
    });
  }

  /** Where a suspect's slot is on screen, with the sign open. */
  private suspectSlot(key: string): { x: number; y: number } {
    const S = SUSPECT_SIGN;
    const slot = S.slots[key];
    return { x: S.x + slot.x * S.width * S.scale, y: S.y + slot.y * S.height * S.scale };
  }

  /** Put the caught suspect, in colour, in his slot (over his silhouette). */
  private fillSlot(key: string) {
    const S = SUSPECT_SIGN;
    const sign = this.suspectSign;
    const slot = S.slots[key];
    if (!sign || !slot) return;
    const x = slot.x * S.width;
    const y = slot.y * S.height;
    const cover = this.add.rectangle(x, y, S.slotWidth * S.width, S.slotHeight * S.height, S.board);
    const figure = this.add.image(x, y, key);
    figure.setScale(Math.min((S.slotWidth * S.width * 0.95) / figure.width, (S.slotHeight * S.height * 0.95) / figure.height));
    sign.add([cover, figure]);
    popIn(this, figure);
  }

  private bookcaseImages(): GameObjects.Image[] {
    return this.searchObjects.filter(
      (o): o is GameObjects.Image => o instanceof GameObjects.Image && BOOKCASES.some((b) => b.key === o.texture.key),
    );
  }

  private checkSearchDone() {
    if (this.state !== 'search') return;
    if (this.foundCount < CLUES.length || this.caughtCount < SUSPECTS.length) return;
    this.state = 'busy';
    this.time.delayedCall(900, () => this.buildAccusation());
  }

  // ---------------------------------------------------------------------------
  // Accusation
  // ---------------------------------------------------------------------------

  private buildAccusation() {
    // Clear the library.
    const leaving = [...this.searchObjects, ...(this.notebook ? [this.notebook] : [])];
    this.searchObjects = [];
    this.tweens.add({ targets: leaving, alpha: 0, duration: 500, onComplete: () => leaving.forEach((o) => o.destroy()) });
    this.notebook = undefined;

    // The tools go: the players point with their hands again.
    for (const tool of [this.glassTool, this.netTool]) tool?.destroy();
    this.glassTool = undefined;
    this.netTool = undefined;
    this.pointers.show();

    // "Wie is de dief?" hangs down from the top.
    const sign = this.add.image(GAME_WIDTH / 2, ACCUSE_SIGN.y, ACCUSE_SIGN.key).setOrigin(0.5, 0).setDepth(DEPTH.content);
    sign.setScale(ACCUSE_SIGN.scale / RENDER_SCALE);
    dropIn(this, sign, { delay: 400, sway: false });

    // The four suspects in a row, in the order of your design.
    const byKey = new Map(this.suspects.map((s) => [s.def.key, s]));
    SUSPECTS.forEach((def, i) => {
      const suspect = byKey.get(def.key)!;
      const { image } = suspect;
      this.tweens.killTweensOf(image);
      image.setVisible(true).setFlipX(false).setAngle(0).setDepth(DEPTH.suspect).setAlpha(1);
      image.setScale(def.height / image.height).setPosition(LINEUP.xs[i], LINEUP.y);
      riseIn(this, image, { delay: 600 + i * 150, distance: 900 });
    });

    // The notebook with the three clues, lying at the bottom.
    const row = this.add.image(GAME_WIDTH / 2, NOTEBOOK_ROW.y, NOTEBOOK_ROW.key).setOrigin(0.5, 0).setDepth(DEPTH.content);
    row.setScale(NOTEBOOK_ROW.width / row.width);
    riseIn(this, row, { delay: 900, distance: 500, sway: false, overshoot: false });
    this.accuseObjects = [sign, row];

    this.time.delayedCall(1600, () => (this.state = 'accuse'));
  }

  /**
   * A click on the suspect you think is the thief. With two players (a controller in use), both
   * have to choose the same one: each choice shows as that player's hand above the suspect, and
   * only when both hands are above the same suspect does it count. With just the mouse, one click.
   */
  private tryAccuse(point: { x: number; y: number }, player: 1 | 2) {
    const suspect = this.suspects.find((s) => s.image.getBounds().contains(point.x, point.y));
    if (!suspect) return;
    if (inputManager.getMode() !== 'tilt') {
      this.accuse(suspect);
      return;
    }

    this.chooseSuspect(player, suspect);
    const other = player === 1 ? 2 : 1;
    if (this.accuseChoice[other] !== suspect) return;
    // Both chose this one.
    this.time.delayedCall(250, () => {
      if (this.state !== 'accuse') return;
      this.clearChoices();
      this.accuse(suspect);
    });
  }

  private accuse(suspect: SuspectState) {
    if (suspect.def.thief) this.catchThief(suspect);
    else this.showWrong(suspect);
  }

  /** A player's choice: their hand (pointing down) above the suspect's head. Choosing another one moves it. */
  private chooseSuspect(player: 1 | 2, suspect: SuspectState) {
    swing(this, suspect.image, 4);
    if (this.accuseChoice[player] === suspect) return;
    this.accuseChoice[player] = suspect;
    this.choiceHands[player]?.destroy();

    const { image } = suspect;
    const top = image.y - image.displayHeight;
    // The player's hand turned upside down (pointing at the head), with its drop shadow.
    const hand = addHandImage(
      this,
      player,
      image.x + (player === 1 ? -1 : 1) * CHOICE_HAND.dx,
      top - CHOICE_HAND.aboveHead,
      CHOICE_HAND.height,
      180,
    ).setDepth(DEPTH.message);
    popIn(this, hand);
    // Pointing: a little bob up and down.
    this.tweens.add({ targets: hand, y: hand.y + 12, duration: 450, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    this.choiceHands[player] = hand;
  }

  private clearChoices() {
    this.accuseChoice = {};
    for (const hand of Object.values(this.choiceHands)) {
      this.tweens.killTweensOf(hand);
      this.tweens.add({ targets: hand, scale: 0, duration: 200, onComplete: () => hand.destroy() });
    }
    this.choiceHands = {};
  }

  /** Wrong: "FOUT!" next to his head and his quote over him; they can choose again. */
  private showWrong(suspect: SuspectState) {
    this.hideWrong();
    swing(this, suspect.image, 10);
    const { image } = suspect;
    const height = image.displayHeight;
    const top = image.y - height;

    const fout = this.add.image(image.x + WRONG.foutX * height, top + WRONG.foutY * height, 'dt-fout').setDepth(DEPTH.message);
    fout.setScale(WRONG.foutWidth / fout.width).setAngle(6);
    popIn(this, fout);
    this.wrongObjects.push(fout);

    if (suspect.def.quote) {
      const quote = this.add.image(0, top + WRONG.quoteY * height, quoteKey(suspect.def.key)).setDepth(DEPTH.message);
      quote.setScale(WRONG.quoteWidth / quote.width);
      // Keep it on the screen.
      quote.setX(PMath.Clamp(image.x, quote.displayWidth / 2 + 20, GAME_WIDTH - quote.displayWidth / 2 - 20));
      popIn(this, quote, { delay: 150 });
      this.wrongObjects.push(quote);
    }

    const first = fout;
    this.time.delayedCall(WRONG.time, () => {
      if (this.wrongObjects[0] === first) this.hideWrong();
    });
  }

  private hideWrong() {
    const objects = this.wrongObjects;
    this.wrongObjects = [];
    for (const o of objects) {
      this.tweens.killTweensOf(o);
      this.tweens.add({ targets: o, alpha: 0, scale: o.scale * 0.8, duration: 250, onComplete: () => o.destroy() });
    }
  }

  // ---------------------------------------------------------------------------
  // The end: the thief drops the book
  // ---------------------------------------------------------------------------

  private catchThief(thief: SuspectState) {
    this.state = 'done';
    this.hideWrong();
    const { image } = thief;

    // Everything else goes: the other suspects, the sign and the notebook.
    for (const s of this.suspects) {
      if (s !== thief) sinkOut(this, s.image, { delay: PMath.Between(0, 200), onComplete: () => s.image.setVisible(false) });
    }
    for (const o of this.accuseObjects) this.tweens.add({ targets: o, alpha: 0, duration: 400, onComplete: () => o.destroy() });
    this.accuseObjects = [];

    // The thief comes big to the left, with his quote.
    const e = ENDING;
    this.tweens.killTweensOf(image);
    image.setDepth(DEPTH.content).setAngle(0);
    this.tweens.add({
      targets: image,
      x: e.thief.x,
      y: e.thief.y,
      scale: e.thief.height / image.height,
      duration: 900,
      delay: 300,
      ease: 'Back.Out',
      onComplete: () => sway(this, image, 1.5),
    });
    if (thief.def.quote) {
      const quote = this.add.image(e.quote.x, e.quote.y, quoteKey(thief.def.key)).setDepth(DEPTH.message);
      quote.setScale(e.quote.width / quote.width);
      popIn(this, quote, { delay: 1100 });
    }

    // "Proficiat! Het boek is terecht!" comes up on the right.
    const sign = this.add.image(e.sign.x, e.sign.bottomY, e.sign.key).setOrigin(0.5, 1).setDepth(DEPTH.content);
    sign.setScale(e.sign.width / sign.width);
    riseIn(this, sign, { delay: 1200, sway: false });

    // Then he drops the stolen book, it comes to the front and opens.
    this.time.delayedCall(1200 + e.bookDelay, () => {
      const book = this.add
        .image(image.x + image.displayWidth * 0.2, image.y - image.displayHeight * 0.45, 'dt-stolen-book')
        .setDepth(DEPTH.message);
      book.setScale(150 / book.height);
      this.tweens.add({ targets: book, y: image.y - 60, angle: 200, duration: 700, ease: 'Bounce.Out' });
      this.time.delayedCall(900, () => {
        this.overlay = this.overlay ?? this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000).setOrigin(0).setAlpha(0);
        this.overlay.setDepth(DEPTH.message - 2);
        this.tweens.add({ targets: this.overlay, alpha: 0.6, duration: 600 });
        this.tweens.add({
          targets: book,
          x: GAME_WIDTH / 2,
          y: GAME_HEIGHT / 2,
          scale: 420 / book.height,
          angle: 360,
          duration: 800,
          ease: 'Back.Out',
          onComplete: () => this.time.delayedCall(500, () => this.openBook(book)),
        });
      });
    });
  }

  /** The closed book becomes the open book (content comes later), like in the geschiedenis game. */
  private openBook(book: GameObjects.Image) {
    this.tweens.killTweensOf(book);
    this.tweens.add({ targets: book, alpha: 0, scale: book.scale * 1.2, duration: 400 });
    if (this.overlay) this.tweens.add({ targets: this.overlay, alpha: 0.8, duration: 400 });

    const open = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'dt-book-open').setDepth(DEPTH.message + 1).setAlpha(0);
    const scale = Math.min((GAME_WIDTH * 0.9) / open.width, (GAME_HEIGHT * 0.85) / open.height);
    open.setScale(scale * 0.6);
    this.tweens.add({ targets: open, alpha: 1, scale, duration: 600, ease: 'Back.Out' });

    // The back button goes on top, so it can be seen and clicked.
    this.children.list
      .filter((o): o is GameObjects.Image => o instanceof GameObjects.Image && o.texture.key === 'dt-back')
      .forEach((button) => button.setDepth(DEPTH.message + 2));
  }
}

function quoteKey(suspectKey: string): string {
  return `${suspectKey}-quote`;
}

/** Distance from a point to a rectangle (0 when the point is inside). */
function distanceToRect(point: { x: number; y: number }, rect: Geom.Rectangle): number {
  const dx = Math.max(rect.left - point.x, 0, point.x - rect.right);
  const dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom);
  return Math.hypot(dx, dy);
}
