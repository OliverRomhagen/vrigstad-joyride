import D from '#data/vrigstad.json';

// counted while the page is prerendered, so the hero's numbers don't wait for the map's data, which only the getaway loads
export const load = () => ({
  ownShell: true,
  buildings: D.b.length,
  streets: new Set(D.r.map(r => r.n).filter(Boolean)).size,
});
