// Multiplayer prototype (lab: multiplayer, docs/multiplayer.md): what a connector gives the session. A transport
// only moves messages between the players of one room; it knows nothing of the game. Connectors implement it:
// tabs-transport.ts (the tabs of one browser) and loopback.ts (in memory, for tests) so far.

/** One player's end of a room. The session sets `receive` and `left`; a message that arrives before that is lost. */
export interface Transport {
  /** this player's id, the same one the others get as `from` */
  readonly me: string;
  /**
   * Sends plain data to every other player in the room. A reliable message arrives, and in the order sent; one that
   * isn't may be lost or arrive late, which suits what is sent again soon anyway.
   */
  send(data: unknown, reliable: boolean): void;
  /** a message from another player; `data` is input from outside, unchecked */
  receive: (from: string, data: unknown) => void;
  /** another player said goodbye; one who vanishes without it is noticed by their silence */
  left: (peer: string) => void;
  /** leaves the room */
  close(): void;
}
