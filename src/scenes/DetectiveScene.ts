import { GameObjects, Input, Scene, Tweens, type Types } from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, RENDER_SCALE, setupCamera } from '../config';
import { inputManager } from '../input/InputManager';
import { PlayerPointers } from '../playerPointers';
import { dropIn, popIn, riseIn, slideIn } from '../puppet';
import { loadSvgParts } from '../svgParts';

/*
 * Minigame "detectieve" (only the opening screens so far).
 *
 *  0. Title: "DETECTIEVE" with the letters falling in one by one, then the
 *     net and the magnifying glass come in.
 *  1. Intro: the title shrinks to the top, the tools move to their player's
 *     card, and the cards and the sign come up.
 *
 * The game itself comes later: in the intro, a button press does nothing yet.
 */

const PATH = 'assets/minigame-detectieve/';

// ---------------------------------------------------------------------------
// Layout (game coordinates) — tweak to move things around
// ---------------------------------------------------------------------------

/** Center of the letters of "DETECTIEVE" inside detectieve.svg (in SVG pixels). */
const TITLE_SVG_CENTER = { x: 933, y: 370 };
/** Big title on the title screen, small title at the top of the intro. */
const TITLE_BIG = { x: 965, y: 588, scale: 0.89 };
const TITLE_SMALL = { x: 966, y: 226, scale: 0.426 };
/** Time between two letters falling in. */
const TITLE_LETTER_DELAY = 70;
/** The title goes on to the intro by itself after this many ms (a button press goes on sooner). */
const TITLE_TIME = 4500;

/** Where the net (player 2) and the magnifying glass (player 1) are; width = size on screen. */
const TOOL_SPOTS = {
  title: { net: { x: 234, y: 406, width: 370 }, glass: { x: 1444, y: 801, width: 268 } },
  intro: { net: { x: 1456, y: 405, width: 370 }, glass: { x: 660, y: 740, width: 268 } },
};

/** Cards and sign stand with the end of their stick/post below the screen. */
const BOTTOM_Y = GAME_HEIGHT + 40;
const CARDS = {
  p1: { key: 'dt-card-p1', file: 'speler1-stap1.svg', x: 336, scale: 0.868 },
  p2: { key: 'dt-card-p2', file: 'speler2-stap1.svg', x: 1579, scale: 0.879 },
};
const SIGN = { x: GAME_WIDTH / 2, scale: 0.887 };

/** Draw order (higher = on top). */
// The net and magnifying glass are in front of the cards.
const DEPTH = { background: 0, content: 5, tools: 6, backButton: 10 };

type State = 'title' | 'titleReady' | 'busy' | 'intro' | 'introReady';

export class DetectiveScene extends Scene {
  private state: State = 'title';
  private letters: { image: GameObjects.Image; svgX: number; svgY: number }[] = [];
  private net?: GameObjects.Image;
  private glass?: GameObjects.Image;
  private pointers!: PlayerPointers;

  constructor() {
    super('DetectiveScene');
  }

  preload() {
    this.load.image('dt-background', PATH + 'background.png');
    this.load.svg('dt-net', PATH + 'net.svg', { scale: RENDER_SCALE });
    this.load.svg('dt-glass', PATH + 'vergrootglas.svg', { scale: RENDER_SCALE });
    this.load.svg('dt-sign', PATH + 'sign.svg', { scale: RENDER_SCALE });
    Object.values(CARDS).forEach((card) => this.load.svg(card.key, PATH + card.file, { scale: RENDER_SCALE }));
    // Loaded as text: split into one image per letter (see svgParts.ts).
    this.load.text('dt-title', PATH + 'detectieve.svg');
    // Shared with the geschiedenis game.
    this.load.image('dt-back', 'assets/minigame-geschiedenis/back-button.png');
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
    this.net = undefined;
    this.glass = undefined;

    this.add.image(0, 0, 'dt-background').setOrigin(0).setDisplaySize(GAME_WIDTH, GAME_HEIGHT).setDepth(DEPTH.background);

    // The players' hands as the cursor.
    this.pointers = new PlayerPointers(this);
    this.pointers.show();

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

    // The title shrinks and moves to the top, letter by letter.
    this.letters.forEach(({ image, svgX, svgY }, i) => {
      this.tweens.add({
        targets: image,
        x: this.titleX(svgX, TITLE_SMALL),
        y: this.titleY(svgY, TITLE_SMALL),
        scale: TITLE_SMALL.scale / RENDER_SCALE,
        delay: i * 30,
        duration: 900,
        ease: 'Back.InOut',
      });
    });

    // The tools don't leave: they move to their player's card.
    this.moveTool(this.net, TOOL_SPOTS.intro.net, (net) => this.netSwish(net));
    this.moveTool(this.glass, TOOL_SPOTS.intro.glass, (glass) => this.glassCircle(glass));

    // The cards come up on their sticks; the sign comes up once and stands still.
    const sign = this.add
      .image(SIGN.x, BOTTOM_Y, 'dt-sign')
      .setOrigin(0.5, 1)
      .setScale(SIGN.scale / RENDER_SCALE)
      .setDepth(DEPTH.content);
    riseIn(this, sign, { delay: 300, sway: false });
    for (const [i, card] of [CARDS.p1, CARDS.p2].entries()) {
      const image = this.add
        .image(card.x, BOTTOM_Y, card.key)
        .setOrigin(0.5, 1)
        .setScale(card.scale / RENDER_SCALE)
        .setDepth(DEPTH.content);
      riseIn(this, image, { delay: 550 + i * 150 });
    }

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
}
