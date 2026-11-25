import { FilmGrain } from './iso800-grain';

// A body-level sibling covers the WebGL canvas and every DOM game overlay.
// The host supplies only a motion flag; the effect owns its animation resources.
export const filmGrain = new FilmGrain(document.body);
