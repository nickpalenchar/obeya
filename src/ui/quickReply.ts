// One-click replies on the entries of „Braucht dich“ (the navigation's list, the phone's): the decision
// the card's own buttons make, without opening the card. Of an entry's replies exactly one is the
// default, as on the card; what only the card can settle (an idea's reply, several questions, a
// choice of many or several options, a proposal with questions of its own, a pull request waiting for
// its merge) has none. A reply that sets work in motion waits out an undo before it is sent.

import { answerText } from './answer';
import { ApiError, api, cardsOn } from './api';
import { ACK_MS } from './tell';
import { type CardAction, handedOver, type Item, openQuestions, type Question, type RepoRef } from '../core/types';
import { plain } from './markdown';
import { failText, snoozeWhen, t } from './strings';

export interface QuickReply {
  label: string;
  /** What the click does to the card `id`; `keepalive` when it is sent as the page goes. */
  send: (id: string, keepalive: boolean) => Promise<void>;
  /** The confirmation. */
  ack: string;
  /** Taking it back afterwards, where the card's own button offers that (a removal). */
  undo?: (id: string) => Promise<unknown>;
  /** Sent only once its undo has run out (or the page closes), as it sets work in motion. */
  held?: true;
  /** What the card says meanwhile, where the server takes a while once it is sent (a landing). */
  pending?: string;
  primary?: true;
  title?: string;
  /** An approval of an agent's work: once it went through, the owner is asked for feedback on it. */
  rates?: true;
}

/** Options that fit as buttons on an entry; a longer choice is made on the card. */
export const QUICK_OPTIONS = 4;

const act = (a: CardAction) => (id: string, keepalive: boolean) => api.act(id, a, keepalive);

/** The single question's options as replies, the one its agent would pick the default; none where it is not one click. */
function options(q: Question): QuickReply[] {
  if (q.multiple || q.stuck || !q.options.length || q.options.length > QUICK_OPTIONS) return [];
  const pick = q.pick?.options.length === 1 ? q.pick.options[0] : undefined;
  return q.options.map((o) => ({
    label: o,
    send: act({ action: 'answer', text: answerText([q], [[o]], ''), picks: [o] }),
    ack: t.quick.answered(o),
    held: true,
    ...(o === pick ? { primary: true as const, title: t.quick.pickHint } : {}),
  }));
}

/** The approval as the card's primary button makes it, for the card in the repository `repo`. */
function approval(i: Item, repo: RepoRef | undefined): QuickReply[] {
  const c = i.contribution;
  if (c) {
    // requests to the contributor beside the agent's own changes: sending them is decided on the card
    if (c.held?.asks.length) return [];
    const label = c.held ? (c.clash ? t.review.pushMergeAnyway(c.number) : t.review.pushMerge(c.number)) : c.clash ? t.review.mergeAnyway(c.number) : t.review.merge(c.number);
    return [{ label, send: act({ action: 'approve' }), ack: t.review.merged(c.number), held: true, pending: c.held ? t.review.pushingHeld : t.review.merging, primary: true }];
  }
  if (i.noChange) return [{ label: t.approveNoChange, send: act({ action: 'approve' }), ack: t.approvedNoChange, held: true, primary: true, rates: true }];
  if (repo?.folder) return [{ label: t.approve, send: act({ action: 'approve' }), ack: t.folder.approved, held: true, primary: true, rates: true }];
  const pr = (i.lands?.land ?? (repo?.pullRequests ? 'pr' : 'main')) === 'pr';
  return [{ label: pr ? t.approvePr : t.approve, send: act({ action: 'approve' }), ack: t.approved, held: true, pending: t.approving, primary: true, rates: true }];
}

/** The replies an entry offers, its card in the repository `repo` of its canvas. */
export function quickReplies(i: Item, repo?: RepoRef): QuickReply[] {
  if (i.superseded)
    return [
      { label: t.superseded.keep, send: act({ action: 'keep' }), ack: t.quick.kept, primary: true, title: t.superseded.keepHint },
      { label: t.superseded.remove, send: (id) => api.remove(id), ack: t.deleted(plain(i.title)), undo: (id) => api.restore(id), title: t.superseded.removeHint },
    ];
  if (i.state === 'proposal') {
    if (i.proposal?.revising || i.proposal?.acceptAfterRevision) return [];
    const p = i.proposal;
    const later = !p?.idea && !!p?.startAt;
    const accept: QuickReply[] = openQuestions(i).length
      ? []
      : [
          {
            label: p?.idea ? t.acceptIdea : later ? t.acceptOnly : t.accept,
            send: act({ action: 'accept' }),
            ack: p?.idea ? t.acceptedIdea : later && Date.parse(p.startAt!) > Date.now() ? t.acceptedLater(snoozeWhen(p.startAt!)) : t.accepted,
            held: true,
            primary: true,
          },
        ];
    return [...accept, { label: t.dismiss, send: act({ action: 'dismiss' }), ack: t.dismissed, held: true }];
  }
  if (i.state !== 'waiting' || i.landing) return [];
  // a question waiting on the card is its decision; a handover without one waits for the approval
  const asked = openQuestions(i);
  if (asked.length) return asked.length === 1 ? options(asked[0]!) : [];
  return handedOver(i) ? approval(i, repo) : [];
}

/** A reply on its way: the card's mark that it is under way (`null` takes it off), and the lines above the microphone. */
export interface ReplyUi {
  mark: (id: string, what: string | null) => void;
  showAck: (text: string, undo?: () => unknown, undoMs?: number) => void;
  showWait: (text: string) => void;
  /** Asks for feedback on the card's approved work (`feedback.tsx`). */
  rate?: (id: string) => void;
}

/**
 * Sends `r` for the card `i` on the canvas `canvas`: its entry leaves the list at once and comes back
 * with the reason if the server refuses; a held one goes out once its undo has run out.
 */
export function sendReply(canvas: string, i: Item, r: QuickReply, ui: ReplyUi) {
  cardsOn(canvas, [i.id]);
  const title = plain(i.title);
  ui.mark(i.id, r.pending ?? r.label);
  const refused = (e: unknown) => {
    if (!(e instanceof ApiError)) console.error(e);
    ui.mark(i.id, null);
    ui.showAck(t.cardError(title, failText(e)));
  };
  const go = (keepalive: boolean) => {
    if (r.pending) ui.showWait(`${r.pending.charAt(0).toUpperCase()}${r.pending.slice(1)}`);
    return r.send(i.id, keepalive).then(() => {
      if (r.rates) ui.rate?.(i.id);
      if (r.pending || !r.held) ui.showAck(r.ack, r.undo && (() => r.undo!(i.id)));
    }, refused);
  };
  if (!r.held) return void go(false);
  let sent = false;
  const fire = (keepalive: boolean) => {
    if (sent) return;
    sent = true;
    clearTimeout(timer);
    removeEventListener('pagehide', away);
    void go(keepalive);
  };
  const away = () => fire(true);
  const timer = setTimeout(() => fire(false), ACK_MS);
  addEventListener('pagehide', away);
  ui.showAck(r.ack, () => {
    if (sent) return;
    sent = true;
    clearTimeout(timer);
    removeEventListener('pagehide', away);
    ui.mark(i.id, null);
  });
}
