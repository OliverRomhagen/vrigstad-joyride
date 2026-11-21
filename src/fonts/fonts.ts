// The pages' fonts, served from the site instead of Google Fonts (#75), plus a ?font= switch to try other families in
// the real game and map before choosing one. Each page's CSS draws with var(--body) and var(--display); applyFont
// registers the chosen family under the two names those point at, so a page downloads only that family's files.
// The files stay beside the page instead of being inlined into it (vite.config.ts). Latin subsets only: they cover
// Swedish (å ä ö) and every name in the game.
import barlow400 from '@fontsource/barlow/files/barlow-latin-400-normal.woff2?url';
import barlow500 from '@fontsource/barlow/files/barlow-latin-500-normal.woff2?url';
import barlow600 from '@fontsource/barlow/files/barlow-latin-600-normal.woff2?url';
import barlowCondensed500 from '@fontsource/barlow-condensed/files/barlow-condensed-latin-500-normal.woff2?url';
import barlowCondensed600 from '@fontsource/barlow-condensed/files/barlow-condensed-latin-600-normal.woff2?url';
import barlowCondensed700 from '@fontsource/barlow-condensed/files/barlow-condensed-latin-700-normal.woff2?url';
import archivo from '@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2?url';
import bricolage from '@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wdth-normal.woff2?url';
import encodeSans from '@fontsource-variable/encode-sans/files/encode-sans-latin-wdth-normal.woff2?url';
import inter from '@fontsource-variable/inter/files/inter-latin-opsz-normal.woff2?url';
import monaSans from '@fontsource-variable/mona-sans/files/mona-sans-latin-wdth-normal.woff2?url';
import robotoFlex from '@fontsource-variable/roboto-flex/files/roboto-flex-latin-wdth-normal.woff2?url';
import saira from '@fontsource-variable/saira/files/saira-latin-wdth-normal.woff2?url';
import allo from 'allo-font/fonts/webfonts/AlloVariable.woff2?url';

/** One font file and the weights it draws. */
interface Face {
  src: string;
  /** a single weight for a static file, a range for a variable one */
  weight: string;
}

interface FontChoice {
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

/** One variable file for both roles, condensed for display when it has a width axis. */
const variable = (src: string, weight: string, displayStretch?: string): FontChoice => ({
  body: [{ src, weight }],
  display: [{ src, weight }],
  displayStretch,
});

const FONTS = {
  barlow: {
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
  },
  // no width axis: the display text is as wide as the body's
  allo: variable(allo, '100 900'),
  'allo-round': { ...variable(allo, '100 900'), variation: '"ROND" 100' },
  inter: variable(inter, '100 900'),
  // Encode Sans's narrowest is still 0.86 of its body width. Roboto Flex barely narrows through font-stretch (0.92 at
  // 50%); its wdth axis would need font-variation-settings on every display rule.
  archivo: variable(archivo, '100 900', '75%'),
  bricolage: variable(bricolage, '200 800', '75%'),
  'encode-sans': variable(encodeSans, '100 900', '75%'),
  'mona-sans': variable(monaSans, '200 900', '87%'),
  'roboto-flex': variable(robotoFlex, '100 1000', '50%'),
  saira: variable(saira, '100 900', '75%'),
} satisfies Record<string, FontChoice>;

export type FontId = keyof typeof FONTS;

/** Today's look, and what a page gets without ?font= or with an id it doesn't know. */
export const DEFAULT_FONT: FontId = 'barlow';

/** The font a query string asks for (`?font=allo`), or the default. */
export function parseFont(search: string): FontId {
  const id = new URLSearchParams(search).get('font')?.trim().toLowerCase();
  return id && Object.hasOwn(FONTS, id) ? (id as FontId) : DEFAULT_FONT;
}

/** Registers a font's faces and points the page's --body and --display at them, before anything is drawn with them. */
export function applyFont(doc: Document, id: FontId): void {
  const font: FontChoice = FONTS[id];
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
