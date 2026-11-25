import { GameObjects, Input, Scene, type Types } from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE, setupCamera } from '../config';
import { inputManager } from '../input/InputManager';
import { PlayerPointers } from '../playerPointers';
import { dropIn, popIn, riseIn, sinkOut, slideIn } from '../puppet';
import { loadSvgParts } from '../svgParts';
import { addPressButtonText } from '../ui';

/*
 * Minigame "komedie" (only the opening screens so far).
 *
 *  0. Title: "KOMEDIE" with the letters falling in one by one, then the
 *     feather and the balloon come in.
 *  1. Intro: the letters go, the feather and balloon move to their spot next
 *     to the cards, and the cards, the sign and "druk op een knop" come up.
 *
 * The game itself comes later: in the intro, a button press does nothing yet.
 */

const PATH = 'assets/minigame-komedie/';

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

/** Where the feather and the balloon are; width = size on screen (game pixels). */
const TOOL_SPOTS = {
  title: { feather: { x: 359, y: 462, width: 320 }, balloon: { x: 1292, y: 908, width: 230 } },
  intro: { feather: { x: 671, y: 535, width: 320 }, balloon: { x: 1317, y: 560, width: 232 } },
};

/** Cards and sign stand with the end of their stick/post below the screen. */
const BOTTOM_Y = GAME_HEIGHT + 40;
const CARDS = {
  p1: { key: 'km-card-p1', file: 'speler1-stap1.svg', x: 326, scale: 0.886 },
  p2: { key: 'km-card-p2', file: 'speler2-stap1.svg', x: 1656, scale: 0.875 },
};
/** The sign's post is short: its end sits just at the bottom edge, so the whole post is visible. */
const SIGN = { x: GAME_WIDTH / 2, bottomY: GAME_HEIGHT + 4, scale: 0.883 };
/** "druk op een knop om het spel te starten", just above the sign. */
const PRESS_TEXT_Y = 834;

/** Draw order (higher = on top). The feather and balloon are in front of the cards. */
const DEPTH = { background: 0, content: 5, tools: 6, backButton: 10 };

type State = 'title' | 'titleReady' | 'busy' | 'intro' | 'introReady';

export class KomedieScene extends Scene {
  private state: State = 'title';
  private letters: GameObjects.Image[] = [];
  private feather?: GameObjects.Image;
  private balloon?: GameObjects.Image;
  private pointers!: PlayerPointers;

  constructor() {
    super('KomedieScene');
  }

  preload() {
    this.load.image('km-background', PATH + 'background.jpg');
    this.load.svg('km-feather', PATH + 'veer.svg', { scale: RENDER_SCALE });
    this.load.svg('km-balloon', PATH + 'ballon.svg', { scale: RENDER_SCALE });
    this.load.svg('km-sign', PATH + 'sign.svg', { scale: RENDER_SCALE });
    Object.values(CARDS).forEach((card) => this.load.svg(card.key, PATH + card.file, { scale: RENDER_SCALE }));
    // Loaded as text: split into one image per letter (see svgParts.ts).
    this.load.text('km-title', PATH + 'komedie.svg');
    // Shared with the geschiedenis game.
    this.load.image('km-back', 'assets/minigame-geschiedenis/back-button.png');
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
    this.feather = undefined;
    this.balloon = undefined;

    this.add.image(0, 0, 'km-background').setOrigin(0).setDisplaySize(GAME_WIDTH, GAME_HEIGHT).setDepth(DEPTH.background);

    // The players' hands as the cursor.
    this.pointers = new PlayerPointers(this);
    this.pointers.show();
    // Title and explanation: both players' hands (player 1 controller, player 2 mouse).
    inputManager.setSplit(this);

    this.addBackButton();

    this.input.on('pointerup', this.pressButton, this);
    this.events.once('shutdown', () => this.input.off('pointerup', this.pressButton, this));

    void this.showTitle();
  }

  /** "The button" (mouse click for now, ESP32 button later). */
  private pressButton() {
    if (this.state === 'titleReady') this.showIntro();
    // In the intro nothing happens yet: the game itself comes later.
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
        this.cameras.main.fadeOut(400, 0, 0, 0);
        this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('MenuScene', { skipTitle: true }));
      });
    popIn(this, button, { delay: 300 });
  }

  // ---------------------------------------------------------------------------
  // Title
  // ---------------------------------------------------------------------------

  private async showTitle() {
    const title = await loadSvgParts(this, this.cache.text.get('km-title'), 'km-title', RENDER_SCALE);
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

    // Then the feather and the balloon come in. They stay for the intro.
    const toolsDelay = 400 + this.letters.length * TITLE_LETTER_DELAY;
    const { feather: f, balloon: b } = TOOL_SPOTS.title;
    this.feather = this.add.image(f.x, f.y, 'km-feather').setDepth(DEPTH.tools);
    this.feather.setScale(f.width / this.feather.width);
    this.balloon = this.add.image(b.x, b.y, 'km-balloon').setDepth(DEPTH.tools);
    this.balloon.setScale(b.width / this.balloon.width);
    const feather = this.feather;
    const balloon = this.balloon;
    slideIn(this, feather, 'left', { delay: toolsDelay, sway: false, onComplete: () => this.tickle(feather) });
    slideIn(this, balloon, 'right', { delay: toolsDelay + 150, sway: false, onComplete: () => this.float(balloon) });

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

    // The feather and balloon don't leave: they move to their spot next to the cards.
    this.moveTool(this.feather, TOOL_SPOTS.intro.feather, (feather) => this.tickle(feather));
    this.moveTool(this.balloon, TOOL_SPOTS.intro.balloon, (balloon) => this.float(balloon));

    // The cards come up on their sticks; the sign comes up once and stands still.
    const sign = this.add
      .image(SIGN.x, SIGN.bottomY, 'km-sign')
      .setOrigin(0.5, 1)
      .setScale(SIGN.scale / RENDER_SCALE)
      .setDepth(DEPTH.content);
    riseIn(this, sign, { delay: 300, sway: false, overshoot: false });
    for (const [i, card] of [CARDS.p1, CARDS.p2].entries()) {
      const image = this.add
        .image(card.x, BOTTOM_Y, card.key)
        .setOrigin(0.5, 1)
        .setScale(card.scale / RENDER_SCALE)
        .setDepth(DEPTH.content);
      riseIn(this, image, { delay: 550 + i * 150, gentle: true });
    }

    void addPressButtonText(this, GAME_WIDTH / 2, PRESS_TEXT_Y, { depth: DEPTH.content, delay: 900 });

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

  /** The feather tickles: quick little wiggles. */
  private tickle(feather: GameObjects.Image) {
    this.tweens.add({ targets: feather, angle: { from: -8, to: 8 }, duration: 160, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    this.tweens.add({ targets: feather, x: feather.x + 14, duration: 320, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
  }

  /** The balloon floats up and down and sways a little. */
  private float(balloon: GameObjects.Image) {
    this.tweens.add({ targets: balloon, y: balloon.y - 24, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    this.tweens.add({ targets: balloon, angle: { from: -5, to: 5 }, duration: 1900, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
  }
}
