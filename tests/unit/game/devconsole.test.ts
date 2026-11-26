import { expect, it } from 'vitest';
import { consoleOwnsKey } from '../../../src/game/devconsole';

it('names the keys the console opens and closes on, so a control can’t take one', () => {
  // the console opens on the characters § and `, which the common layouts have on one of these two keys
  for (const code of ['Backquote', 'IntlBackslash', 'Escape']) expect(consoleOwnsKey(code), code).toBe(true);
  for (const code of ['KeyX', 'Digit1', 'Tab']) expect(consoleOwnsKey(code), code).toBe(false);
});
