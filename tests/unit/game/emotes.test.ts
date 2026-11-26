import { describe, expect, it } from 'vitest';
import { Commands } from '../../../src/game/commands';
import { EMOTES, type Emoting, registerEmoteCommands, startEmote, stepEmote } from '../../../src/game/emotes';

const onFoot = (): Emoting => ({ emote: null });

describe('emotes', () => {
  it('a dance loops until something stops it, and then stops at once', () => {
    const p = onFoot();
    startEmote(p, 'dance');
    for (let i = 0; i < 600; i++) stepEmote(p, 1 / 60, false); // 10 s
    expect(p.emote?.id).toBe('dance');
    stepEmote(p, 1 / 60, true);
    expect(p.emote).toBeNull();
  });

  it('blowing a kiss plays for 1.6 s and then ends by itself', () => {
    const p = onFoot();
    startEmote(p, 'kiss');
    stepEmote(p, 1.5, false);
    expect(p.emote).toEqual({ id: 'kiss', t: 1.5 });
    stepEmote(p, 0.2, false);
    expect(p.emote).toBeNull();
  });

  it('a new emote replaces the one playing, from its start', () => {
    const p = onFoot();
    startEmote(p, 'dance');
    stepEmote(p, 3, false);
    startEmote(p, 'wave');
    expect(p.emote).toEqual({ id: 'wave', t: 0 });
  });

  it('names each emote once', () => {
    expect(new Set(EMOTES.map(e => e.id)).size).toBe(EMOTES.length);
  });

  it('the console plays each emote by its name, for players too, and says why when you cannot', () => {
    const p = onFoot();
    let why: string | null = 'Get out of the car first.';
    const commands = new Commands({ allowed: access => access === 'player' });
    registerEmoteCommands(commands, p, () => why);
    expect(commands.run('twerk')).toBe('Get out of the car first.');
    expect(p.emote).toBeNull();
    why = null;
    expect(commands.run('twerk')).toBe('Twerk.');
    expect(p.emote).toEqual({ id: 'twerk', t: 0 });
    commands.run('grodorna');
    expect(p.emote?.id).toBe('grodorna');
  });
});
