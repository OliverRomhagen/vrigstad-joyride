// Where you stand, as numbers (#637): the `?at=` text that starts the game at a spot, the line under the minimap that
// shows it, and the console's `coords`. Pure: the page module (src/game/coords-line.ts) reads where you are and owns
// the DOM.
import { ROAD_WIDTH_M, RoadClass } from '../../world/data';
import { segmentDistance } from '../../world/polygon';
import type { RoadNetwork } from '../../world/roads';
import { command, optional, toggle } from '../command-args';
import type { Commands } from '../commands';

/** A street this close to you, from its edge, is named in the line (m). */
const STREET_NEAR_M = 25;

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** Where you stand and look: the camera's yaw and pitch in radians, as `?at=` reads them. */
export interface Viewpoint {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
}

/** The value of `?at=` that starts the game at this spot, looking the same way: `x,z,yaw,pitch`. */
export function atParam(s: Viewpoint): string {
  return [s.x.toFixed(1), s.z.toFixed(1), s.yaw.toFixed(2), s.pitch.toFixed(2)].join(',');
}

/**
 * The way a camera yaw faces, as a compass point and whole degrees clockwise from north: `NE 45°`. The camera looks
 * along (sin yaw, -cos yaw), and z points south, so a yaw of 0 faces north and π/2 east.
 */
export function heading(yaw: number): string {
  const deg = Math.round((((yaw * 180) / Math.PI) % 360) + 360) % 360;
  return `${COMPASS[Math.round(deg / 45) % 8]} ${deg}°`;
}

/** The name of the nearest named street within `reachM` of its edge, or '' when none is. */
export function nearestStreet(
  roads: Pick<RoadNetwork, 'forEachSegmentNear' | 'lines'>,
  x: number,
  z: number,
  reachM = STREET_NEAR_M,
): string {
  let best = '',
    bestD = reachM;
  // the distance is to the road's edge: reach past it by the widest road's half width
  roads.forEachSegmentNear(x, z, reachM + ROAD_WIDTH_M[RoadClass.PRIMARY] / 2, (ax, az, bx, bz, ri) => {
    const road = roads.lines[ri];
    if (!road.n) return;
    const d = segmentDistance(x, z, ax, az, bx, bz) - ROAD_WIDTH_M[road.c] / 2;
    if (d <= bestD) {
      bestD = d;
      best = road.n;
    }
  });
  return best;
}

/** The line's first part: position to a decimetre and the way you face. `x 12.3  z -45.6  NE 45°`. */
export function spotLine(s: Viewpoint): string {
  return `x ${s.x.toFixed(1)}  z ${s.z.toFixed(1)}  ${heading(s.yaw)}`;
}

/** What `coords` switches and reads. */
export interface CoordsView {
  shown: boolean;
  /** the page's address with `?at=` for where you stand */
  link(): string;
}

/** The console's `coords`: on its own it answers with the `?at=` link; `coords on` and `coords off` show or hide the line. */
export function registerCoordsCommands(commands: Pick<Commands, 'register'>, view: CoordsView): void {
  commands.register(
    'coords',
    command({
      help: 'give a link to where you stand, or show or hide the line under the minimap',
      details: 'The link has ?at=x,z,yaw,pitch: opening it starts you there, facing the same way.',
      examples: ['coords', 'coords on', 'coords off'],
      args: [optional(toggle('line'))],
      run: ({ line }) => {
        if (line === undefined) return view.link();
        view.shown = line;
        return line ? 'Coordinates on: tap or click them to copy a link.' : 'Coordinates off.';
      },
    }),
  );
}
