import { FilmGrain } from './iso800-grain';

// A body-level sibling covers the WebGL canvas and every DOM game overlay.
// It deliberately has no dependency on the Three.js scene or game loop.
new FilmGrain(document.body);
