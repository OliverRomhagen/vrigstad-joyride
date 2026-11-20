import { describe, expect, it } from 'vitest';
import { newGameState, newViewState } from '../../../src/game/state';

describe('newGameState', () => {
  it('starts before Start, on foot, with nothing taken', () => {
    expect(newGameState()).toEqual({
      started: false,
      clockS: 0,
      inCar: false,
      pcar: null,
      jumpQ: false,
      stolen: 0,
      ramCool: 0,
      bigT: 0,
      treats: 0,
    });
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
