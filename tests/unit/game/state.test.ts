import { describe, expect, it } from 'vitest';
import { newGameState, newViewState } from '../../../src/game/state';

describe('newGameState', () => {
  it('starts before Start, on foot, with nothing taken', () => {
    const { started, inCar, pcar, jumpQ, ...counts } = newGameState();
    expect({ started, inCar, pcar, jumpQ }).toEqual({ started: false, inCar: false, pcar: null, jumpQ: false });
    // every other field is a counter or timer, so a new one that doesn't start at 0 fails here
    for (const [name, n] of Object.entries(counts)) expect([name, n]).toEqual([name, 0]);
  });

  it('gives a fresh object each time, so one game never writes into another', () => {
    const a = newGameState();
    a.treats = 3;
    expect(newGameState().treats).toBe(0);
  });
});

describe('newViewState', () => {
  it('looks the way it is told, straight ahead, with the look-back timer already run out', () => {
    expect(newViewState(0.6, 0.34)).toEqual({ camYaw: 0.6, camPitch: 0.34, lookOff: 0, lookIdle: 9 });
  });
});
