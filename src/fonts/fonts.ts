// The pages' fonts, served from the site instead of Google Fonts (#75). Each page's CSS draws with var(--body) and
// var(--display); applyFont registers a family under the two names those point at, so a page downloads only that
// family's files. Barlow is everyone's; the fonts lab experiment (src/lab/fonts/) lets a player pick another.
// The files stay beside the page instead of being inlined into it (vite.config.ts). Latin subsets only: they cover
// Swedish (å ä ö) and every name in the game.
import barlow400 from '@fontsource/barlow/files/barlow-latin-400-normal.woff2?url';
import barlow500 from '@fontsource/barlow/files/barlow-latin-500-normal.woff2?url';
import barlow600 from '@fontsource/barlow/files/barlow-latin-600-normal.woff2?url';
import barlowCondensed500 from '@fontsource/barlow-condensed/files/barlow-condensed-latin-500-normal.woff2?url';
import barlowCondensed600 from '@fontsource/barlow-condensed/files/barlow-condensed-latin-600-normal.woff2?url';
import barlowCondensed700 from '@fontsource/barlow-condensed/files/barlow-condensed-latin-700-normal.woff2?url';

/** One font file and the weights it draws. */
interface Face {
  src: string;
  /** a single weight for a static file, a range for a variable one */
  weight: string;
}

export interface FontChoice {
  /** running text */
  body: Face[];
  /** headings, buttons, the HUD and the map's labels */
  display: Face[];
  /**
   * The display faces have a width axis: draw them at this width (a font-stretch percentage). Each family's own scale
   * differs, so each is set to draw about as narrow as Barlow Condensed is to Barlow (0.8 of the body's width).
   */
  displayStretch?: string;
  /** font-variation-settings for the whole page, for axes CSS has no property for */
  variation?: string;
}

const BODY_FAMILY = 'Joyride Body';
const DISPLAY_FAMILY = 'Joyride Display';
const BODY_FALLBACK = '"Helvetica Neue", Arial, sans-serif';
const DISPLAY_FALLBACK = '"Arial Narrow", "Helvetica Neue", Arial, sans-serif';

/** Barlow for running text and Barlow Condensed for display: what every page draws in unless a player picks another. */
export const BARLOW: FontChoice = {
  body: [
    { src: barlow400, weight: '400' },
    { src: barlow500, weight: '500' },
    { src: barlow600, weight: '600' },
  ],
  display: [
    { src: barlowCondensed500, weight: '500' },
    { src: barlowCondensed600, weight: '600' },
    { src: barlowCondensed700, weight: '700' },
  ],
};

/** Registers a font's faces and points the page's --body and --display at them, before anything is drawn with them. */
export function applyFont(doc: Document, font: FontChoice): void {
  const add = (family: string, faces: Face[], stretch?: string) => {
    for (const { src, weight } of faces) {
      // A face given one width draws a page that asks for normal width at the nearest width it allows, so every rule
      // that draws with var(--display) is condensed without setting font-stretch itself.
      doc.fonts.add(
        new FontFace(family, `url(${src}) format('woff2')`, { weight, display: 'swap', ...(stretch && { stretch }) }),
      );
    }
  };
  add(BODY_FAMILY, font.body);
  add(DISPLAY_FAMILY, font.display, font.displayStretch);
  const root = doc.documentElement.style;
  root.setProperty('--body', `"${BODY_FAMILY}", ${BODY_FALLBACK}`);
  root.setProperty('--display', `"${DISPLAY_FAMILY}", ${DISPLAY_FALLBACK}`);
  if (font.variation) {
    // On every element: the pages' `font:` shorthands reset font-variation-settings, so it can't be inherited from the root.
    const style = doc.createElement('style');
    style.textContent = `*, ::before, ::after { font-variation-settings: ${font.variation} !important; }`;
    doc.head.append(style);
  }
}
