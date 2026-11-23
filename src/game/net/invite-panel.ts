// Multiplayer prototype (lab: multiplayer, docs/multiplayer.md): the panel for a connector that joins by codes the
// players pass each other by hand (the webrtc one). One player makes an invite code, the friend pastes it and gets a
// reply code, and the first pastes that. Page code: it builds its own DOM over the game.
import type { Invites } from './transport';

const CSS = `
#mp { position: absolute; right: max(12px, env(safe-area-inset-right, 0px)); bottom: calc(12px + env(safe-area-inset-bottom, 0px)); z-index: 60;
  width: min(340px, calc(100vw - 24px)); box-sizing: border-box; pointer-events: auto; font: 500 13px/1.4 system-ui, sans-serif; color: #f4f1e6;
  background: rgba(16, 22, 30, .9); border: 2px solid #e8c14a; border-radius: 6px; padding: 8px 10px; }
#mp button { font: inherit; color: #10161e; background: #e8c14a; border: 0; border-radius: 4px; padding: 5px 10px; cursor: pointer; }
#mp button:disabled { opacity: .5; cursor: default; }
#mp .mp-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
#mp .mp-row { display: flex; gap: 8px; margin-top: 8px; }
#mp p { margin: 8px 0 4px; }
#mp textarea { display: block; box-sizing: border-box; width: 100%; height: 64px; resize: none; font: 11px/1.3 ui-monospace, Menlo, Consolas, monospace;
  color: inherit; background: rgba(244, 241, 230, .1); border: 1px solid rgba(244, 241, 230, .4); border-radius: 4px; padding: 4px 6px; word-break: break-all; }
#mp .mp-error { color: #ffb4a8; }
#mp .mp-notice { font-size: 12px; opacity: .8; overflow-wrap: anywhere; }
`;

/** What the panel reads. */
export interface InvitePanelDeps {
  stage: HTMLElement;
  invites: Invites;
  /** how many other players are connected and shown */
  peers(): number;
}

type Step = 'idle' | 'inviting' | 'joining';

/** Puts the panel in the corner of the game. */
export function showInvitePanel(g: InvitePanelDeps) {
  // the properties are loosely typed: checking them against every element type is more than tsc will do
  function el<K extends 'div' | 'span' | 'button' | 'p' | 'textarea' | 'style'>(
    tag: K,
    text = '',
    props: Record<string, string | boolean> = {},
  ): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    e.textContent = text;
    return Object.assign(e, props);
  }
  const root = el('div', '', { id: 'mp' }),
    head = el('div', '', { className: 'mp-head' }),
    title = el('span'),
    toggle = el('button', 'Invite', { type: 'button' }),
    body = el('div', '', { hidden: true }),
    choose = el('div', '', { className: 'mp-row' }),
    inviteBtn = el('button', 'Invite a friend', { type: 'button' }),
    joinBtn = el('button', 'I have an invite', { type: 'button' }),
    notice = el('p', g.invites.notice, { id: 'mp-notice', className: 'mp-notice' }),
    outLabel = el('p'),
    out = el('textarea', '', { readOnly: true, id: 'mp-out', ariaLabel: 'Code to send' }),
    copy = el('button', 'Copy', { type: 'button' }),
    inLabel = el('p'),
    input = el('textarea', '', { id: 'mp-in', ariaLabel: 'Code from your friend', spellcheck: false }),
    go = el('button', '', { type: 'button', id: 'mp-go' }),
    back = el('button', 'Start over', { type: 'button' }),
    status = el('p', '', { id: 'mp-status' });
  status.setAttribute('role', 'status');
  head.append(title, toggle);
  choose.append(inviteBtn, joinBtn);
  const copyRow = el('div', '', { className: 'mp-row' }),
    goRow = el('div', '', { className: 'mp-row' });
  copyRow.append(copy);
  goRow.append(go, back);
  body.append(choose, notice, outLabel, out, copyRow, inLabel, input, goRow, status);
  root.append(el('style', CSS), head, body);
  // typing a code must not drive the car: the game listens for keys further up
  for (const type of ['keydown', 'keyup', 'keypress'] as const) root.addEventListener(type, e => e.stopPropagation());

  let step: Step = 'idle',
    replied = false, // joining: the reply code is made
    waiting = false; // this swap is done, and waits for the friend to connect
  const say = (text: string, isError = false) => {
    status.textContent = text;
    status.className = isError ? 'mp-error' : '';
  };
  // what shows depends on the step: the code to send, the box to paste into, or both
  function draw() {
    const sending = (step === 'inviting' && !!out.value) || (step === 'joining' && replied),
      pasting = (step === 'inviting' && !!out.value) || (step === 'joining' && !replied);
    choose.hidden = notice.hidden = step !== 'idle';
    outLabel.hidden = out.hidden = copyRow.hidden = !sending;
    inLabel.hidden = input.hidden = go.hidden = !pasting;
    goRow.hidden = step === 'idle';
    outLabel.textContent =
      step === 'inviting' ? '1. Send this invite code to your friend:' : '2. Send this reply code back to your friend:';
    inLabel.textContent =
      step === 'inviting' ? '2. Paste the reply code they send back:' : '1. Paste the invite code from your friend:';
    go.textContent = step === 'inviting' ? 'Connect' : 'Make the reply code';
  }
  function reset() {
    step = 'idle';
    replied = waiting = false;
    out.value = input.value = '';
    draw();
  }
  // runs one step, with its buttons off meanwhile; what goes wrong is said in the panel
  async function run(work: () => Promise<void>) {
    for (const b of [inviteBtn, joinBtn, go, back]) b.disabled = true;
    try {
      await work();
    } catch (err) {
      say(err instanceof Error ? err.message : String(err), true);
    }
    for (const b of [inviteBtn, joinBtn, go, back]) b.disabled = false;
    draw();
  }

  toggle.addEventListener('click', () => {
    body.hidden = !body.hidden;
    toggle.textContent = body.hidden ? 'Invite' : 'Close';
  });
  inviteBtn.addEventListener('click', () =>
    run(async () => {
      say('Making an invite…');
      waiting = false;
      out.value = await g.invites.invite();
      step = 'inviting';
      say('');
    }),
  );
  joinBtn.addEventListener('click', () => {
    step = 'joining';
    waiting = false;
    say('');
    draw();
  });
  back.addEventListener('click', () => {
    g.invites.cancel();
    reset();
    say('');
  });
  copy.addEventListener('click', () => {
    out.select();
    navigator.clipboard?.writeText(out.value).then(
      () => say('Copied.'),
      () => say('Select the code and copy it.'),
    );
  });
  go.addEventListener('click', () =>
    run(async () => {
      if (step === 'joining') {
        out.value = await g.invites.accept(input.value);
        replied = waiting = true;
        say('Waiting for your friend to paste the reply…');
      } else {
        await g.invites.finish(input.value);
        waiting = true;
        say('Connecting…');
      }
    }),
  );

  // a friend connecting ends the swap that waits for them, and not one started since; one shown again after a
  // while in the background is no new connection
  let shown = -1,
    linked = 0;
  setInterval(() => {
    const { links } = g.invites;
    if (links > linked) {
      if (waiting) reset();
      say('Connected.');
    }
    linked = links;
    const n = g.peers();
    if (n === shown) return;
    shown = n;
    title.textContent = n ? 'Playing with ' + n + (n === 1 ? ' friend' : ' friends') : 'Playing alone';
  }, 300);
  draw();
  g.stage.append(root);
}
