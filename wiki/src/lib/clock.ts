// What tells the time, for code that has to know it rather than be handed a frame's dt: the page passes in the real clock
// (`{ now: () => performance.now() }`), and a test passes one it moves by hand, so time in a test is plain numbers.

/** Wall time in ms, from any start, that only goes forward. */
export interface Clock {
  now(): number;
}
