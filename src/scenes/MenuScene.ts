import { GameObjects, Scene } from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE, setupCamera } from '../config';
import { dropIn, riseIn, sway, swing } from '../puppet';
import { loadSvgParts } from '../svgParts';

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
const PRESS_TEXT = { x: GAME_WIDTH / 2, y: 880, text: 'druk op een knop om het spel te starten' };

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
  /** Where the string and the label center are inside the SVG (in SVG pixels). */
  svgStringX: number;
  svgLabelY: number;
}

const GENRES: Genre[] = [
  { key: 'menu-genre-geschiedenis', file: 'geschiedenis.svg', scene: 'GeschiedenisScene', x: 240, labelY: 293, svgStringX: 206.5, svgLabelY: 462 },
  { key: 'menu-genre-grappig', file: 'grappig.svg', x: 537, labelY: 658, svgStringX: 323.5, svgLabelY: 1054 },
  { key: 'menu-genre-mystery', file: 'mystery.svg', x: 847, labelY: 238, svgStringX: 434.5, svgLabelY: 745 },
  { key: 'menu-genre-adventure', file: 'adventure.svg', x: 1230, labelY: 468, svgStringX: 206.5, svgLabelY: 1179 },
  { key: 'menu-genre-fantasy', file: 'fantasy.svg', x: 1604, labelY: 256, svgStringX: 148.5, svgLabelY: 728 },
];

/** "Kies een genre" sign: center x, bottom of the post (below the screen), size. */
const GENRE_SIGN = { x: 1499, bottomY: 1320, scale: 0.865 };

const DEPTH = { background: 0, content: 5, paper: 10 };

type State = 'title' | 'titleReady' | 'busy' | 'genres';

export class MenuScene extends Scene {
  private state: State = 'title';
  private titleObjects: GameObjects.GameObject[] = [];

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
    // Loaded as text: split into one image per letter (see svgParts.ts).
    this.load.text('menu-title', PATH + 'landvankaboeko.svg');
  }

  create(data: { skipTitle?: boolean }) {
    setupCamera(this);
    this.titleObjects = [];
    this.input.setDefaultCursor('default');

    this.add.image(0, 0, 'menu-background').setOrigin(0).setDisplaySize(GAME_WIDTH, GAME_HEIGHT).setDepth(DEPTH.background);
    this.addPaperEdges();

    this.input.on('pointerup', this.pressButton, this);
    this.events.once('shutdown', () => this.input.off('pointerup', this.pressButton, this));

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
    const ribbon = this.add
      .image(TITLE_RIBBON.x, TITLE_RIBBON.y, 'menu-ribbon')
      .setOrigin(0.5, 0)
      .setScale(TITLE_RIBBON.scale / RENDER_SCALE)
      .setDepth(DEPTH.content);
    dropIn(this, ribbon, { delay: done, distance: 700, onComplete: () => sway(this, ribbon, 6, 1600) });

    const book = this.add
      .image(TITLE_BOOK.x, TITLE_BOOK.y, 'menu-book')
      .setScale(TITLE_BOOK.scale / RENDER_SCALE)
      .setDepth(DEPTH.content);
    riseIn(this, book, {
      delay: done + 150,
      onComplete: () => {
        sway(this, book, 4, 1800);
        this.tweens.add({ targets: book, y: book.y - 12, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
      },
    });

    const press = this.add
      .text(PRESS_TEXT.x, PRESS_TEXT.y, PRESS_TEXT.text, {
        fontFamily: '"Arial Narrow", Arial, sans-serif',
        fontStyle: 'bold',
        fontSize: '34px',
        color: '#FFFFFF',
        resolution: RENDER_SCALE,
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.content)
      .setAlpha(0);
    this.tweens.add({ targets: press, alpha: { from: 0.25, to: 1 }, delay: done + 600, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.InOut' });

    this.titleObjects.push(ribbon, book, press);
    this.time.delayedCall(done + 400, () => {
      if (this.state === 'title') this.state = 'titleReady';
    });
  }

  private leaveTitle() {
    this.state = 'busy';

    // Cross-fade: the title fades away while the genre books come in.
    const objects = this.titleObjects;
    this.titleObjects = [];
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
        .setInteractive({ pixelPerfect: true, useHandCursor: true })
        .on('pointerover', () => this.state === 'genres' && swing(this, image, 2))
        .on('pointerup', () => this.chooseGenre(genre, image));
    });

    const sign = this.add
      .image(GENRE_SIGN.x, GENRE_SIGN.bottomY, 'menu-genre-sign')
      .setOrigin(0.5, 1)
      .setScale(GENRE_SIGN.scale / RENDER_SCALE)
      .setDepth(DEPTH.content);
    // Comes up once, then stands still.
    riseIn(this, sign, { delay: 400, distance: 500, sway: false });

    this.time.delayedCall(700, () => (this.state = 'genres'));
  }

  private chooseGenre(genre: Genre, image: GameObjects.Image) {
    if (this.state !== 'genres') return;

    // No game for this genre yet: just give the book a shake.
    if (!genre.scene) {
      swing(this, image, 8);
      return;
    }

    this.state = 'busy';
    const scene = genre.scene;
    swing(this, image, 10);
    this.cameras.main.fadeOut(600, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start(scene));
  }
}
