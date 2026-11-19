import type { Scene } from 'phaser';

/*
 * Splits an SVG into one texture per <path> (e.g. one per letter of a title),
 * so each part can be animated on its own.
 *
 * Load the SVG as text first:   this.load.text('my-title', 'assets/title.svg');
 * Then in create():             const title = await loadSvgParts(this, this.cache.text.get('my-title'), 'my-title');
 *
 * Note: paths must be at the top level of the SVG (or in groups without a transform).
 */

export interface SvgPart {
  /** Texture key of this part. */
  key: string;
  /** Center of the part, in the coordinates of the original SVG. */
  x: number;
  y: number;
}

export interface SvgParts {
  /** Size of the original SVG. */
  width: number;
  height: number;
  parts: SvgPart[];
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Extra space around each part so edges aren't cut off. */
const PADDING = 6;

/**
 * @param resolution How many texture pixels per SVG pixel (use RENDER_SCALE for sharp output,
 *                   then display the parts at scale 1 / RENDER_SCALE).
 */
export async function loadSvgParts(scene: Scene, svgText: string, keyPrefix: string, resolution = 1): Promise<SvgParts> {
  const source = new DOMParser().parseFromString(svgText, 'image/svg+xml').documentElement;
  const [, , width, height] = (source.getAttribute('viewBox') ?? '0 0 0 0').split(/[\s,]+/).map(Number);
  const defs = source.querySelector('defs')?.outerHTML ?? '';

  // The size of each part can only be measured while the SVG is in the page.
  const holder = document.createElementNS(SVG_NS, 'svg');
  holder.setAttribute('style', 'position:absolute;left:-10000px;top:0;visibility:hidden');
  holder.innerHTML = source.innerHTML;
  document.body.appendChild(holder);

  const paths = Array.from(holder.querySelectorAll('path')).filter((p) => !p.closest('defs, clipPath, mask'));

  try {
    const parts = await Promise.all(
      paths.map(async (path, i) => {
        const box = path.getBBox();
        const x = box.x - PADDING;
        const y = box.y - PADDING;
        const w = box.width + PADDING * 2;
        const h = box.height + PADDING * 2;
        const key = `${keyPrefix}-${i}`;

        // Textures stay in memory, so a restarted scene can reuse them.
        if (!scene.textures.exists(key)) {
          const svg =
            `<svg xmlns="${SVG_NS}" width="${w * resolution}" height="${h * resolution}" viewBox="${x} ${y} ${w} ${h}">` +
            `${defs}${path.outerHTML}</svg>`;
          const image = new Image();
          image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
          await image.decode();
          if (!scene.textures.exists(key)) scene.textures.addImage(key, image);
        }

        return { key, x: x + w / 2, y: y + h / 2 };
      }),
    );
    return { width, height, parts };
  } finally {
    holder.remove();
  }
}
