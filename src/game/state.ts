// The game's shared state, as plain data that modules read and write (#294): what used to be module-level lets in src/game/main.ts.
// Two objects, so #49 can split them: GameState is the game itself, ViewState only how you look at it (the camera).
import type { Car } from './cars';

export interface GameState {
  started: boolean; // Start was pressed
  clockS: number; // s since the page loaded, for hit cool-downs
  inCar: boolean;
  pcar: Car | null; // the car you drive, while inCar
  jumpQ: boolean; // set by a fresh Space / Jump press on foot, used up by the next frame: a held key (braking, then getting out) never jumps, a tap between frames isn't lost
  stolen: number; // cars stolen, each counted the first time you take it
  ramCool: number; // s until ramming a police car can give another star
  bigT: number; // s the big screen (Gripen!, Däckad!) stays up
  treats: number; // cat treats in your pockets
}

export const newGameState = (): GameState => ({
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

export interface ViewState {
  camYaw: number; // radians
  camPitch: number; // radians above the horizon
  lookOff: number; // radians: in a car, how far you have looked away from straight ahead
  lookIdle: number; // s since you last looked around in a car; the view swings back ahead after a while
}

export const newViewState = (camYaw: number, camPitch: number): ViewState => ({
  camYaw,
  camPitch,
  lookOff: 0,
  lookIdle: 9,
});
