// A plain name for a colour the game gives as a hex code, so a paint can be told to someone who can't see it ("Paint it
// dark blue", not "Paint it #27406b"). Rough on purpose: a dozen names anyone would use, not a paint chart.

const HUES: readonly [upTo: number, name: string][] = [
  [15, 'red'],
  [45, 'orange'],
  [70, 'yellow'],
  [170, 'green'],
  [200, 'teal'],
  [260, 'blue'],
  [320, 'purple'],
  [360, 'red'],
];

/** The name of a colour given as `#rrggbb`: its hue, with "dark" or "light" when it is; black, white, grey, beige or brown when those fit better. */
export function colourName(hex: string): string {
  const [r, g, b] = [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 2;
  const spread = max - min;
  const saturation = spread === 0 ? 0 : spread / (1 - Math.abs(2 * light - 1));
  if (light < 0.16) return 'black';
  if (light > 0.85 && saturation < 0.3) return 'white';
  if (saturation < 0.12) return light < 0.3 ? 'dark grey' : light > 0.7 ? 'light grey' : 'grey';
  let hue = 60 * (max === r ? ((g - b) / spread) % 6 : max === g ? (b - r) / spread + 2 : (r - g) / spread + 4);
  if (hue < 0) hue += 360;
  // the earth colours: a pale, dull yellow or orange is beige, a dark one brown
  if (hue >= 15 && hue < 70 && saturation < 0.5) {
    if (light > 0.6) return 'beige';
    if (light < 0.5) return 'brown';
  }
  const name = HUES.find(([upTo]) => hue < upTo)?.[1] ?? 'red';
  return light < 0.3 ? `dark ${name}` : light > 0.7 ? `light ${name}` : name;
}
