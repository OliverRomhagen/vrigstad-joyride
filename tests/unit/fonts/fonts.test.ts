import { describe, expect, it } from 'vitest';
import { DEFAULT_FONT, parseFont } from '../../../src/fonts/fonts';

describe('parseFont', () => {
  it('keeps Barlow without ?font=', () => {
    expect(parseFont('')).toBe('barlow');
    expect(DEFAULT_FONT).toBe('barlow');
  });

  it('reads a known id, ignoring case and spaces', () => {
    expect(parseFont('?font=allo')).toBe('allo');
    expect(parseFont('?font=%20Mona-Sans%20')).toBe('mona-sans');
  });

  it('falls back to the default for an unknown id or an inherited property name', () => {
    expect(parseFont('?font=comic-sans')).toBe('barlow');
    expect(parseFont('?font=toString')).toBe('barlow');
  });
});
