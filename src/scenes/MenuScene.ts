import { GameObjects, Scene, Time, Tweens } from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE, setupCamera } from '../config';
import { dropIn, riseIn, sinkOut, stopSway, sway, swing } from '../puppet';
import { inputManager } from '../input/InputManager';
import { PlayerPointers } from '../playerPointers';
import { loadSvgParts } from '../svgParts';
import { addPressButtonText } from '../ui';

/*
 * Main menu.
 *
 * 1. Title: "Het land van KABOEKO". A button press goes on.
 * 2. Genres: five books hanging on strings. Clicking a book starts that genre's
 *    minigame (only "geschiedenis" exists so far; the others give a shake).
 *
 * Start this scene with { skipTitle: true } to go straight to the genres
 * (e.g. when coming back from a minigame).
 */

const PATH = 'assets/menu/';

// ---------------------------------------------------------------------------
// Layout (game coordinates) — tweak to move things around
// ---------------------------------------------------------------------------

/** "Het land van KABOEKO": top center of the title and its size. */
const TITLE = { x: GAME_WIDTH / 2, y: 320, scale: 0.87 };
const TITLE_BOOK = { x: 1648, y: 800, scale: 0.87 };
const TITLE_RIBBON = { x: 288, y: 450, scale: 0.87 };
/**
 * book.svg and lint.svg have a drop shadow (to the bottom right), which makes the files bigger
 * than the drawing. These are the size of the drawing itself (SVG pixels), so the book turns
 * around its own middle and the ribbon hangs from the middle of its top, as before the shadow.
 */
const BOOK_DRAWING = { width: 251, height: 257 };
const RIBBON_DRAWING = { width: 96 };
/** "druk op een knop om het spel te starten" */
const PRESS_TEXT = { x: GAME_WIDTH / 2, y: 880 };

/** Back to the title screen after this many ms without anyone moving or clicking. */
const IDLE_TIME = 30_000;

/** A book reacts to a hover at most once per this many ms. */
const HOVER_COOLDOWN = 700;

/** Size of the genre books. */
const GENRE_SCALE = 0.9;

interface Genre {
  key: string;
  file: string;
  /** Scene to start, or undefined when the game for this genre doesn't exist yet. */
  scene?: string;
  /** Where the string is (x) and where the label is (y) on screen. */
  x: number;
  labelY: number;
  /** Where the string, the label center and the book center are inside the SVG (in SVG pixels). */
  svgStringX: number;
  svgLabelY: number;
  svgBookY: number;
}

const GENRES: Genre[] = [
  { key: 'menu-genre-geschiedenis', file: 'geschiedenis.svg', scene: 'GeschiedenisScene', x: 240, labelY: 293, svgStringX: 206.5, svgLabelY: 462, svgBookY: 763 },
  { key: 'menu-genre-grappig', file: 'grappig.svg', scene: 'KomedieScene', x: 537, labelY: 658, svgStringX: 323.5, svgLabelY: 1054, svgBookY: 1345 },
  { key: 'menu-genre-mystery', file: 'mystery.svg', scene: 'DetectiveScene', x: 847, labelY: 238, svgStringX: 434.5, svgLabelY: 745, svgBookY: 1011 },
  { key: 'menu-genre-adventure', file: 'adventure.svg', x: 1230, labelY: 468, svgStringX: 206.5, svgLabelY: 1179, svgBookY: 1441 },
  { key: 'menu-genre-fantasy', file: 'fantasy.svg', scene: 'FantasyScene', x: 1604, labelY: 256, svgStringX: 148.5, svgLabelY: 728, svgBookY: 1025 },
];

/** How much bigger a book gets while a hand is over it (1.05 = 5%). */
const HOVER_GROW = 1.05;

/** "Kies een genre" sign: center x, bottom of the post (below the screen), size. */
const GENRE_SIGN = { x: 1499, bottomY: 1320, scale: 0.865 };

const DEPTH = { background: 0, content: 5, paper: 10 };

type State = 'title' | 'titleReady' | 'busy' | 'genres';

export class MenuScene extends Scene {
  private state: State = 'title';
  private titleObjects: GameObjects.GameObject[] = [];
  private genreBooks: GameObjects.Image[] = [];
  private genreSign?: GameObjects.Image;
  private idleTimer?: Time.TimerEvent;
  /** The players' hands on the genre screen. */
  private pointers!: PlayerPointers;

  constructor() {
    super('MenuScene');
  }

  preload() {
    const svg = (key: string, file: string, size: { width: number; height: number } | { scale: number }) =>
      this.load.svg(key, PATH + file, size);

    svg('menu-background', 'background.svg', { width: 3840, height: 2560 });
    svg('menu-paper-top', 'paper-top.svg', { width: 3840, height: Math.round((3840 * 147) / 2160) });
    svg('menu-paper-bottom', 'paper-bottom.svg', { width: 3840, height: Math.round((3840 * 143) / 2160) });
    svg('menu-book', 'book.svg', { scale: RENDER_SCALE });
    svg('menu-ribbon', 'lint.svg', { scale: RENDER_SCALE });
    svg('menu-genre-sign', 'intro-sign.svg', { scale: RENDER_SCALE });
    GENRES.forEach((genre) => svg(genre.key, genre.file, { scale: RENDER_SCALE }));
    // Loaded as text: split into one image per letter (see svgParts.ts). The letters keep their drop shadow.
    this.load.text('menu-title', 'assets/general/kaboeko.svg');
    PlayerPointers.preload(this);
  }

  create(data: { skipTitle?: boolean }) {
    setupCamera(this);
    this.cameras.main.fadeIn(600, 0, 0, 0);
    this.titleObjects = [];
    this.genreBooks = [];
    this.genreSign = undefined;
    this.idleTimer = undefined;
    // The players' hands instead of the mouse cursor, in the whole menu (the mouse is player 2).
    this.pointers = new PlayerPointers(this);
    this.pointers.show();
    // Two players in the whole menu: player 1 with the controller, player 2 with the mouse.
    inputManager.setSplit(this);

    this.add.image(0, 0, 'menu-background').setOrigin(0).setDisplaySize(GAME_WIDTH, GAME_HEIGHT).setDepth(DEPTH.background);
    this.addPaperEdges();

    this.input.on('pointerup', this.pressButton, this);
    // Any mouse movement or click counts as "someone is playing".
    this.input.on('pointermove', this.onActivity, this);
    this.input.on('pointerdown', this.onActivity, this);
    // Player 1's controller (moving or pressing) counts too.
    inputManager.on('cursormove', this.onActivity, this);
    inputManager.on('select', this.onActivity, this);
    this.events.once('shutdown', () => {
      this.input.off('pointerup', this.pressButton, this);
      this.input.off('pointermove', this.onActivity, this);
      this.input.off('pointerdown', this.onActivity, this);
      inputManager.off('cursormove', this.onActivity, this);
      inputManager.off('select', this.onActivity, this);
    });

    if (data?.skipTitle) this.showGenres();
    else this.showTitle();
  }

  /** "The button" (mouse click for now, ESP32 button later). */
  private pressButton() {
    if (this.state === 'titleReady') this.leaveTitle();
  }

  /** Torn paper at the top and bottom (stays still). */
  private addPaperEdges() {
    const top = this.add.image(0, 0, 'menu-paper-top').setOrigin(0, 0);
    const bottom = this.add.image(0, GAME_HEIGHT, 'menu-paper-bottom').setOrigin(0, 1);
    for (const paper of [top, bottom]) {
      paper.setScale(GAME_WIDTH / paper.width).setDepth(DEPTH.paper);
    }
  }

  // ---------------------------------------------------------------------------
  // Title
  // ---------------------------------------------------------------------------

  private async showTitle() {
    this.state = 'title';

    const title = await loadSvgParts(this, this.cache.text.get('menu-title'), 'menu-title', RENDER_SCALE);
    if (!this.sys.isActive() || this.state !== 'title') return;

    // Every letter is its own little puppet.
    title.parts.forEach((part, i) => {
      const letter = this.add
        .image(TITLE.x + (part.x - title.width / 2) * TITLE.scale, TITLE.y + part.y * TITLE.scale, part.key)
        .setScale(TITLE.scale / RENDER_SCALE)
        .setDepth(DEPTH.content);
      dropIn(this, letter, { delay: 100 + i * 70, distance: 900 });
      this.titleObjects.push(letter);
    });

    const done = 100 + title.parts.length * 70;

    // The ribbon hangs from its top, the book wobbles at the end of the word.
    const ribbon = this.add.image(TITLE_RIBBON.x, TITLE_RIBBON.y, 'menu-ribbon');
    ribbon
      .setOrigin(Math.min(0.5, (RIBBON_DRAWING.width / 2) * (RENDER_SCALE / ribbon.width)), 0)
      .setScale(TITLE_RIBBON.scale / RENDER_SCALE)
      .setDepth(DEPTH.content);
    dropIn(this, ribbon, { delay: done, distance: 700, onComplete: () => sway(this, ribbon, 6, 1600) });

    const book = this.add.image(TITLE_BOOK.x, TITLE_BOOK.y, 'menu-book');
    book
      .setOrigin(
        Math.min(0.5, (BOOK_DRAWING.width / 2) * (RENDER_SCALE / book.width)),
        Math.min(0.5, (BOOK_DRAWING.height / 2) * (RENDER_SCALE / book.height)),
      )
      .setScale(TITLE_BOOK.scale / RENDER_SCALE)
      .setDepth(DEPTH.content);
    riseIn(this, book, {
      delay: done + 150,
      onComplete: () => {
        sway(this, book, 4, 1800);
        this.tweens.add({ targets: book, y: book.y - 12, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      },
    });

    this.titleObjects.push(ribbon, book);
    addPressButtonText(this, PRESS_TEXT.x, PRESS_TEXT.y, { depth: DEPTH.content, delay: done + 600 }).then((press) => {
      // Only keep it if the title is still showing.
      if (!press) return;
      if (this.state === 'title' || this.state === 'titleReady') this.titleObjects.push(press);
      else press.destroy();
    });
    this.time.delayedCall(done + 400, () => {
      if (this.state === 'title') this.state = 'titleReady';
    });
  }

  private leaveTitle() {
    this.state = 'busy';

    // Cross-fade: the title fades away while the genre books come in.
    const objects = this.titleObjects;
    this.titleObjects = [];
    // Stop swaying and blinking, so they only fade.
    this.tweens.killTweensOf(objects);
    this.tweens.add({
      targets: objects,
      alpha: 0,
      duration: 500,
      onComplete: () => objects.forEach((o) => o.destroy()),
    });
    this.showGenres();
  }

  // ---------------------------------------------------------------------------
  // Genres
  // ---------------------------------------------------------------------------

  private showGenres() {
    this.state = 'busy';

    GENRES.forEach((genre, i) => {
      // Origin at the top of the string (above the screen), so the book swings from there.
      const image = this.add.image(0, 0, genre.key).setDepth(DEPTH.content);
      const svgWidth = image.width / RENDER_SCALE;
      image
        .setOrigin(genre.svgStringX / svgWidth, 0)
        .setScale(GENRE_SCALE / RENDER_SCALE)
        .setPosition(genre.x, genre.labelY - genre.svgLabelY * GENRE_SCALE)
        .setAlpha(0);

      dropIn(this, image, { delay: 100 + i * 90, distance: 400 });
      this.tweens.add({ targets: image, alpha: 1, delay: 100 + i * 90, duration: 400 });

      image
        // No system hand cursor: the players' own hands are shown instead.
        .setInteractive({ pixelPerfect: true })
        .on('pointerover', () => this.hoverBook(image, genre, true))
        .on('pointerout', () => this.hoverBook(image, genre, false))
        .on('pointerup', () => this.chooseGenre(genre, image));
      this.genreBooks.push(image);
    });

    const sign = this.add
      .image(GENRE_SIGN.x, GENRE_SIGN.bottomY, 'menu-genre-sign')
      .setOrigin(0.5, 1)
      .setScale(GENRE_SIGN.scale / RENDER_SCALE)
      .setDepth(DEPTH.content);
    // Comes up once, then stands still.
    riseIn(this, sign, { delay: 400, distance: 500, sway: false });
    this.genreSign = sign;

    this.time.delayedCall(700, () => {
      this.state = 'genres';
      this.restartIdleTimer();
    });
  }

  /**
   * A hand goes over a book (over = true) or leaves it: the book grows a little
   * and gets a small nudge. Moving over the string, the label and the book counts
   * as one hover, so the book doesn't restart its swing each time.
   */
  private hoverBook(image: GameObjects.Image, genre: Genre, over: boolean) {
    if (this.state !== 'genres') return;

    // Grow around the middle of the book. The book hangs from the top of its string
    // (above the screen), so move it up a bit while it grows, to keep the book in place.
    const grow = over ? HOVER_GROW : 1;
    const baseY = genre.labelY - genre.svgLabelY * GENRE_SCALE;
    const bookCenter = genre.svgBookY * GENRE_SCALE;
    (image.getData('hoverTween') as Tweens.Tween | undefined)?.remove();
    image.setData(
      'hoverTween',
      this.tweens.add({
        targets: image,
        scale: (GENRE_SCALE / RENDER_SCALE) * grow,
        y: baseY - (grow - 1) * bookCenter,
        duration: 220,
        ease: 'Sine.Out',
      }),
    );

    if (!over) return;
    const now = this.time.now;
    if (now - ((image.getData('hoveredAt') as number | undefined) ?? -Infinity) < HOVER_COOLDOWN) return;
    image.setData('hoveredAt', now);
    swing(this, image, 2.5);
  }

  /** Back to the title when nobody has done anything for a while. */
  private restartIdleTimer() {
    this.idleTimer?.remove();
    this.idleTimer = this.time.delayedCall(IDLE_TIME, () => {
      if (this.state === 'genres') this.backToTitle();
    });
  }

  private onActivity() {
    if (this.state === 'genres') this.restartIdleTimer();
  }

  private backToTitle() {
    this.state = 'busy';
    this.idleTimer?.remove();

    // The books are pulled up on their strings, the sign goes down.
    const books = this.genreBooks;
    this.genreBooks = [];
    books.forEach((book, i) => {
      stopSway(book);
      this.tweens.killTweensOf(book);
      this.tweens.add({
        targets: book,
        y: book.y - 1400,
        delay: i * 80,
        duration: 700,
        ease: 'Back.In',
        onComplete: () => book.destroy(),
      });
    });
    const sign = this.genreSign;
    this.genreSign = undefined;
    if (sign) sinkOut(this, sign, { onComplete: () => sign.destroy() });

    this.time.delayedCall(900, () => this.showTitle());
  }

  private chooseGenre(genre: Genre, image: GameObjects.Image) {
    if (this.state !== 'genres') return;

    // No game for this genre yet: just give the book a shake.
    if (!genre.scene) {
      swing(this, image, 8);
      return;
    }

    this.state = 'busy';
    this.idleTimer?.remove();
    inputManager.setSplit(null);
    const scene = genre.scene;
    swing(this, image, 10);
    this.cameras.main.fadeOut(600, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start(scene));
  }
}
