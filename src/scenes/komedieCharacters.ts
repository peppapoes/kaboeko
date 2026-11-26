/*
 * The characters and quotes of the komedie minigame "Wie zei dat?".
 * Edit freely: names, books, quotes, how they move, and their art.
 *
 * All files are in public/assets/minigame-komedie/.
 *  - image:     the character itself (sticker style).
 *  - sign:      wooden sign at the top: "Wie zegt deze quote?" + the quote, WITHOUT the name.
 *  - quoteCard: the big speech bubble shown after a hit: the quote WITH the name.
 *  - audio:     optional sound file (e.g. 'lambik.mp3'), played after a hit.
 *
 * A character with `enabled: false` is never picked (e.g. while its art is missing).
 * If an image is missing anyway, the game shows a placeholder instead.
 */

/**
 * How a character moves around the circus tent (speeds: see CONFIG, places: see the layout, in KomedieScene.ts).
 *  - bounce:   hides behind the podium (the barrel) in the middle, and now and then peeks out, up or to the side
 *  - ball:     balances on the big ball on the right, rolling back and forth; now and then falls over
 *  - cannon:   is shot out of the cannon and flies off the screen on the right, again and again
 *  - walk:     walks back and forth over the floor
 *  - walkFall: walks, and now and then trips and falls over
 *  - fly:      flies a figure-eight through the air
 *  - swing:    swings on the trapeze, across the whole top of the screen
 * The podium, the ball, the cannon and the trapeze are there once: give each of those to one character only.
 */
export type Movement = 'bounce' | 'ball' | 'cannon' | 'walk' | 'walkFall' | 'fly' | 'swing';

export interface ComedyCharacter {
  id: string;
  name: string;
  book: string;
  quote: string;
  image: string;
  sign: string;
  quoteCard: string;
  audio?: string;
  movement: Movement;
  /** Height on screen, in game pixels (the screen is 1920 x 1280). */
  height: number;
  enabled: boolean;
}

export const COMEDY_CHARACTERS: ComedyCharacter[] = [
  {
    id: 'lambik',
    name: 'Lambik',
    book: 'Suske en Wiske',
    quote: 'MILJAAR!!!',
    image: 'lambik.svg',
    sign: 'sign-lambik.svg',
    quoteCard: 'quote-lambik.svg',
    movement: 'bounce',
    height: 430,
    enabled: true,
  },
  {
    id: 'theo',
    name: 'Theo',
    book: 'Het leven van een Loser',
    quote: 'Zoo wee mama!!',
    image: 'theo.svg',
    sign: 'sign-theo.svg',
    quoteCard: 'quote-theo.svg',
    movement: 'ball',
    height: 330,
    enabled: true,
  },
  {
    id: 'kapitein',
    name: 'Kapitein Onderbroek',
    book: 'Kapitein Onderbroek',
    quote: 'Tra-la-laaaaa!',
    image: 'kapitein-onderbroek.svg',
    sign: 'sign-kapitein.svg',
    quoteCard: 'quote-kapitein.svg',
    movement: 'cannon',
    height: 250,
    enabled: true,
  },
  {
    id: 'timon',
    name: 'Timon Verbeeck',
    book: 'Project D.I.N.O.',
    quote: 'Ma stooobbe...',
    image: 'timon.svg',
    sign: 'sign-timon.svg',
    quoteCard: 'quote-timon.svg',
    movement: 'swing',
    height: 260,
    enabled: true,
  },
  // No art yet: switch on (enabled: true) once the three files exist.
  {
    id: 'pippi',
    name: 'Pippi Langkous',
    book: 'Pippi Langkous',
    quote: 'Tjolahopp, tjolahej, tjolahoppsansa!',
    image: 'pippi.svg',
    sign: 'sign-pippi.svg',
    quoteCard: 'quote-pippi.svg',
    // (bounce = the podium, which Lambik already uses: pick another movement if both play.)
    movement: 'walkFall',
    height: 300,
    enabled: false,
  },
  {
    id: 'dikkiedik',
    name: 'Dikkie Dik',
    book: 'Dikkie Dik',
    quote: 'Miauw!',
    image: 'dikkiedik.svg',
    sign: 'sign-dikkiedik.svg',
    quoteCard: 'quote-dikkiedik.svg',
    movement: 'walk',
    height: 200,
    enabled: false,
  },
];
