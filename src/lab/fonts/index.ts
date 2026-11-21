// Lab: choose your font. With ?lab=fonts, ?font=<id> draws both pages in another family instead of Barlow, to compare
// candidates in the real game and map, and as a start on a font setting for readability (#78), such as Atkinson
// Hyperlegible for low vision. A page downloads only the family it draws with, so the list costs nothing unused.

import archivo from '@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2?url';
import atkinson from '@fontsource-variable/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-normal.woff2?url';
import bricolage from '@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wdth-normal.woff2?url';
import encodeSans from '@fontsource-variable/encode-sans/files/encode-sans-latin-wdth-normal.woff2?url';
import inter from '@fontsource-variable/inter/files/inter-latin-opsz-normal.woff2?url';
import monaSans from '@fontsource-variable/mona-sans/files/mona-sans-latin-wdth-normal.woff2?url';
import robotoFlex from '@fontsource-variable/roboto-flex/files/roboto-flex-latin-wdth-normal.woff2?url';
import saira from '@fontsource-variable/saira/files/saira-latin-wdth-normal.woff2?url';
import allo from 'allo-font/fonts/webfonts/AlloVariable.woff2?url';
import { BARLOW, type FontChoice } from '../../fonts/fonts';
import { LabFlags } from '../flags';

/** One variable file for both roles, condensed for display when it has a width axis. */
const variable = (src: string, weight: string, displayStretch?: string): FontChoice => ({
  body: [{ src, weight }],
  display: [{ src, weight }],
  displayStretch,
});

const FONTS = {
  barlow: BARLOW,
  // no width axis: the display text is as wide as the body's
  allo: variable(allo, '100 900'),
  'allo-round': { ...variable(allo, '100 900'), variation: '"ROND" 100' },
  atkinson: variable(atkinson, '200 800'),
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

type FontId = keyof typeof FONTS;

/** The known font a query string asks for (`?font=allo`), ignoring case and spaces, or undefined. */
export function parseFontId(search: string): FontId | undefined {
  const id = new URLSearchParams(search).get('font')?.trim().toLowerCase();
  return id && Object.hasOwn(FONTS, id) ? (id as FontId) : undefined;
}

/** The font a player picked with ?lab=fonts&font=<id>; undefined without the flag or with an id it doesn't know. */
export function labFont(search: string): FontChoice | undefined {
  if (!LabFlags.fromSearch(search).on('fonts')) return undefined;
  const id = parseFontId(search);
  return id && FONTS[id];
}
