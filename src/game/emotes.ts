// Emotes (#296): short animations the player plays on foot. A fixed list, so multiplayer can later send just the id.
// No three.js or DOM here; how each one looks is src/game/render/player-pose.ts.
import { command } from './command-args';
import type { Commands } from './commands';

/** Every emote. `secs` is how long it plays; 0 loops until you move. */
export const EMOTES = [
  { id: 'dance', label: 'Dance', secs: 0 },
  { id: 'kiss', label: 'Blow a kiss', secs: 1.6 },
  { id: 'finger', label: 'The finger', secs: 2.5 },
  { id: 'twerk', label: 'Twerk', secs: 0 },
  { id: 'wave', label: 'Wave', secs: 2 },
  { id: 'shrug', label: 'Shrug', secs: 1.2 },
  { id: 'grodorna', label: 'Små grodorna', secs: 0 },
  { id: 'sit', label: 'Sit down', secs: 0 },
] as const;
export type EmoteId = (typeof EMOTES)[number]['id'];

/** The emote playing, if any: which one and for how long (s). */
export interface Emoting {
  emote: { id: EmoteId; t: number } | null;
}

/** How long an emote plays (s); 0 loops until you move. */
export const emoteSecs = (id: EmoteId) => EMOTES.find(m => m.id === id)!.secs;

export function startEmote(p: Emoting, id: EmoteId) {
  p.emote = { id, t: 0 };
}

/** One frame. `stop` while something ends it: moving, jumping, a car, a safehouse, Gripen!. */
export function stepEmote(p: Emoting, dt: number, stop: boolean) {
  const e = p.emote;
  if (!e) return;
  e.t += dt;
  const secs = emoteSecs(e.id);
  if (stop || (secs > 0 && e.t >= secs)) p.emote = null;
}

/** The console's `dance`, `kiss`, … : one command per emote, with `player` access, so they stay open to everyone once the
 *  console opens outside dev mode. `whyCant` says why you can't emote now, or null. */
export function registerEmoteCommands(commands: Pick<Commands, 'register'>, p: Emoting, whyCant: () => string | null) {
  for (const { id, label } of EMOTES)
    commands.register(
      id,
      command({
        help: `emote: ${label.toLowerCase()}, on foot; moving stops it`,
        access: 'player',
        args: [],
        run: () => {
          const no = whyCant();
          if (no) return no;
          startEmote(p, id);
          return `${label}.`;
        },
      }),
    );
}
