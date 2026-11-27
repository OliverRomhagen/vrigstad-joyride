// Imported glass uses one damage level and UV projection per connected pane, including curved corners.
import * as THREE from 'three';

const MODEL_GLASS_FLAT = 0.94; // roof glass within about 20 degrees of horizontal stays uncracked
const GLASS_WELD_PER_M = 100000; // connectivity only: weld duplicate export vertices to 10 micrometres
const _ga = new THREE.Vector3(),
  _gb = new THREE.Vector3(),
  _gc = new THREE.Vector3();

function glassPanes(p: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) {
  const parents = Array.from({ length: p.count / 3 }, (_, i) => i);
  const root = (start: number) => {
    let i = start;
    while (parents[i] !== i) {
      parents[i] = parents[parents[i]!]!;
      i = parents[i]!;
    }
    return i;
  };
  const vertex = (i: number) => [p.getX(i), p.getY(i), p.getZ(i)].map(v => Math.round(v * GLASS_WELD_PER_M)).join(',');
  const edges = new Map<string, number>();
  for (let i = 0; i < p.count; i += 3) {
    const keys = [vertex(i), vertex(i + 1), vertex(i + 2)];
    for (let j = 0; j < 3; j++) {
      if (keys[j] === keys[(j + 1) % 3]) continue;
      const edge = [keys[j], keys[(j + 1) % 3]].sort().join('/');
      const previous = edges.get(edge);
      if (previous === undefined) edges.set(edge, i / 3);
      else parents[root(i / 3)] = root(previous);
    }
  }
  const areas = new Float64Array(parents.length * 2);
  for (let i = 0; i < p.count; i += 3) {
    _ga.fromBufferAttribute(p, i);
    _gb.fromBufferAttribute(p, i + 1).sub(_ga);
    _gc.fromBufferAttribute(p, i + 2).sub(_ga);
    _gb.cross(_gc); // projected area, so triangulation density cannot decide the pane
    const r = root(i / 3) * 2;
    areas[r] = areas[r]! + Math.abs(_gb.x);
    areas[r + 1] = areas[r + 1]! + Math.abs(_gb.z);
  }
  return parents.map((_, i) => {
    const r = root(i) * 2;
    return areas[r + 1]! > areas[r]! ? 0 : 1;
  });
}

/** Built once per source geometry and cached by CarDamageFx. Authored positions are preserved. */
export function modelCrackGeometry(src: THREE.BufferGeometry) {
  const s = src.index ? src.toNonIndexed() : src,
    P = s.attributes.position;
  const pos: [number[], number[]] = [[], []],
    uv: [number[], number[]] = [[], []];
  const panes = glassPanes(P);
  s.computeBoundingBox();
  const { min: m, max: M } = s.boundingBox!,
    w = M.x - m.x,
    h = M.y - m.y,
    l = M.z - m.z;
  for (let i = 0; i < P.count; i += 3) {
    _ga.fromBufferAttribute(P, i);
    _gb.fromBufferAttribute(P, i + 1);
    _gc.fromBufferAttribute(P, i + 2);
    const n = _gc.sub(_gb).cross(_gb.clone().sub(_ga)).normalize();
    if (Math.abs(n.y) > MODEL_GLASS_FLAT) continue;
    const k = panes[i / 3]!;
    for (let j = 0; j < 3; j++) {
      _ga.fromBufferAttribute(P, i + j);
      pos[k].push(_ga.x, _ga.y, _ga.z);
      uv[k].push(k ? (_ga.z - m.z) / l : (_ga.x - m.x) / w, (_ga.y - m.y) / h);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...pos[0], ...pos[1]], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([...uv[0], ...uv[1]], 2));
  g.addGroup(0, pos[0].length / 3, 0);
  g.addGroup(pos[0].length / 3, pos[1].length / 3, 1);
  if (s !== src) s.dispose();
  return g;
}
