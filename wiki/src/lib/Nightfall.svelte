<!-- Vrigstad at nightfall, under the wiki's footer: the sky from the top of the page comes back as the last light behind the
     forest, a few houses and the church, and the sign where the village ends. A drawing, not the game's rendering; the houses
     are placed by hand, the spruces by a seeded roll, so the prerendered page is the same on every build. -->
<script lang="ts">
// the drawing's size, in its own units. It fills the window's width at its full height (wiki.css), and a phone shows its
// middle, x 530–1070 at 320px wide (xMidYMax slice), so the village and the sign stay between those
const W = 1600;
const H = 200;
const GROUND = 160; // where the houses stand, in the same units

// a spruce: tiers that widen downwards, on a short trunk
function spruce(x: number, h: number, w: number, base = GROUND) {
  const tiers = 5;
  const right: [number, number][] = [];
  for (let i = 1; i <= tiers; i++) {
    const y = base - h + (h * 0.9 * i) / tiers;
    const half = (w / 2) * (0.35 + 0.65 * (i / tiers));
    right.push([x + half, y], [x + half * 0.45, y - h * 0.04]);
  }
  const trunk = w * 0.06;
  const left = right.map(([px, py]): [number, number] => [2 * x - px, py]).reverse();
  const points = [[x, base - h], ...right, [x + trunk, base], [x - trunk, base], ...left];
  return `M${points.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join('L')}Z`;
}

// the forest behind the village: a seeded roll, so every build draws the same trees
function drawForest(seed: number) {
  const roll = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  let d = '';
  for (let x = -20; x < W + 40; x += 30 * (0.6 + roll() * 0.8)) {
    const h = 40 + roll() * 50;
    d += spruce(x, h, h * (0.42 + roll() * 0.12), GROUND - 10 + roll() * 6);
  }
  return d;
}
const forest = drawForest(7);

// the village, in a loose cluster round the middle: x is the house's left wall, `lit` a window with the light on
const HOUSES = [
  { x: 536, w: 46, h: 22, roof: 15, hasChimney: true },
  { x: 600, w: 56, h: 27, roof: 18, hasChimney: true, lit: true },
  { x: 818, w: 48, h: 21, roof: 14, lit: true },
  { x: 896, w: 40, h: 25, roof: 16, hasChimney: true, lit: true },
];
const house = ({ x, w, h, roof, hasChimney }: (typeof HOUSES)[number]) => {
  const chimney = `M${x + Math.round(w * 0.68)},${GROUND - h - Math.round(roof * 0.45)}v${-Math.round(roof * 0.55)}h4v${Math.round(roof * 0.38)}Z`;
  return `M${x},${GROUND}V${GROUND - h}L${x + w / 2},${GROUND - h - roof}L${x + w},${GROUND - h}V${GROUND}Z${hasChimney ? chimney : ''}`;
};
// the church: a nave, and a west tower with a lantern spire
const CHURCH_X = 696;
const church =
  `M${CHURCH_X},${GROUND}V${GROUND - 44}L${CHURCH_X + 58},${GROUND - 72}L${CHURCH_X + 116},${GROUND - 44}V${GROUND}Z` +
  `M${CHURCH_X - 32},${GROUND}V${GROUND - 90}H${CHURCH_X + 2}V${GROUND}Z` +
  `M${CHURCH_X - 36},${GROUND - 90}L${CHURCH_X - 15},${GROUND - 118}L${CHURCH_X + 6},${GROUND - 90}Z` +
  `M${CHURCH_X - 19},${GROUND - 118}h8v-14h-8Z M${CHURCH_X - 15},${GROUND - 146}l5,14h-10Z`;
const trees = [588, 878].map((x, i) => spruce(x, 52 + i * 12, 26)).join('');
const village = HOUSES.map(house).join('') + church + trees;
const windows = HOUSES.filter(h => h.lit).map(h => ({
  x: h.x + Math.round(h.w * 0.3),
  y: GROUND - Math.round(h.h * 0.7),
}));

const SIGN = { x: 944, y: GROUND - 72 }; // where the village ends, the far side of the last house
</script>

<svg class="nightfall" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="nightfall-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1d1f24" stop-opacity="0" />
      <stop offset="0.55" stop-color="#3d3140" stop-opacity="0.7" />
      <stop offset="1" stop-color="#8f565b" stop-opacity="0.5" />
    </linearGradient>
  </defs>
  <rect width={W} height={H} fill="url(#nightfall-sky)" />
  <path d={forest} fill="#221f28" />
  <rect y={GROUND - 10} width={W} height={H - GROUND + 10} fill="#221f28" />
  <path d={village} fill="#101116" />
  <rect y={GROUND} width={W} height={H - GROUND} fill="#101116" />
  {#each windows as lit (lit.x)}
    <rect x={lit.x} y={lit.y} width="7" height="8" fill="#f3c98b" opacity="0.55" />
  {/each}
  <!-- the end of the village: its name, struck through, on a blue Swedish place-name sign; dimmed, as by dusk -->
  <g opacity="0.55">
    <rect x={SIGN.x + 57} y={SIGN.y + 40} width="4" height={GROUND - SIGN.y - 40} fill="#3a3d44" />
    <rect x={SIGN.x} y={SIGN.y} width="118" height="42" rx="4" fill="#123a63" stroke="#aeb7c0" stroke-width="2.5" />
    <text x={SIGN.x + 59} y={SIGN.y + 29} text-anchor="middle" fill="#c3cbd3" class="nightfall-sign">Vrigstad</text>
    <line x1={SIGN.x + 4} y1={SIGN.y + 38} x2={SIGN.x + 114} y2={SIGN.y + 4} stroke="#9b2c31" stroke-width="5" />
  </g>
</svg>

