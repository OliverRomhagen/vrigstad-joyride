// Multiplayer prototype (lab: multiplayer, docs/multiplayer.md): what a connector gives the session. A transport
// only moves messages between the players of one room; it knows nothing of the game. Connectors implement it:
// tabs-transport.ts (the tabs of one browser) and loopback.ts (in memory, for tests) so far.

/**
 * Joining by codes the players pass each other by hand, for a connector with no server to introduce them. One
 * player makes an invite, the friend answers it with a reply, and the first finishes with that reply.
 */
export interface Invites {
  /** a code to send to one friend */
  invite(): Promise<string>;
  /** takes a friend's invite code and gives the reply code to send back; throws an Error to show the player */
  accept(code: string): Promise<string>;
  /** takes the reply to an invite made here; throws an Error to show the player */
  finish(code: string): Promise<void>;
}

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
  /** set by a connector whose players join by passing codes; the game then shows the panel for it */
  readonly invites?: Invites;
}
