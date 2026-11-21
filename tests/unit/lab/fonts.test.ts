import { describe, expect, it } from 'vitest';
import { BARLOW } from '../../../src/fonts/fonts';
import { labFont, parseFontId } from '../../../src/lab/fonts';

describe('parseFontId', () => {
  it('reads a known id, ignoring case and spaces', () => {
    expect(parseFontId('?font=allo')).toBe('allo');
    expect(parseFontId('?font=%20Mona-Sans%20')).toBe('mona-sans');
  });

  it('gives nothing for no id, an unknown id or an inherited property name', () => {
    expect(parseFontId('')).toBeUndefined();
    expect(parseFontId('?font=comic-sans')).toBeUndefined();
    expect(parseFontId('?font=toString')).toBeUndefined();
  });
});

describe('labFont', () => {
  it('picks nothing without the fonts lab flag, so everyone gets Barlow', () => {
    expect(labFont('?font=allo')).toBeUndefined();
    expect(labFont('?lab=hello&font=allo')).toBeUndefined();
  });

  it('picks the asked font with the flag, and nothing for an unknown one', () => {
    expect(labFont('?lab=fonts&font=barlow')).toBe(BARLOW);
    expect(labFont('?lab=fonts&font=saira')?.displayStretch).toBe('75%');
    expect(labFont('?lab=fonts&font=comic-sans')).toBeUndefined();
    expect(labFont('?lab=fonts')).toBeUndefined();
  });
});
