import { expect, test } from 'bun:test';
import type { CardAction, Item, RepoRef } from '../core/types';
import { api } from './api';
import { quickReplies } from './quickReply';
import { t } from './strings';

const card = (over: Partial<Item>): Item => ({ id: 'x', kind: 'task', state: 'waiting', title: 'T', body: '', x: 0, y: 0, source: 'manual', repo: 'r', ...over }) as Item;
const repo = (over: Partial<RepoRef> = {}): RepoRef => ({ id: 'r', name: 'r', ...over }) as RepoRef;

/** What each reply sends to the card, by its label. */
async function sent(i: Item, r = repo()) {
  const was = api.act;
  const out: [string, CardAction | 'remove', boolean][] = [];
  try {
    for (const q of quickReplies(i, r)) {
      let a: CardAction | 'remove' = 'remove';
      api.act = async (_id, x) => void (a = x);
      const remove = api.remove;
      api.remove = async () => void (a = 'remove');
      await q.send(i.id, false);
      api.remove = remove;
      out.push([q.label, a, !!q.primary]);
    }
  } finally {
    api.act = was;
  }
  return out;
}

test('a handover has its approval as its one primary reply, as the card names it', async () => {
  expect(await sent(card({ need: 'demo' }))).toEqual([[t.approve, { action: 'approve' }, true]]);
  expect((await sent(card({ need: 'demo' }), repo({ pullRequests: true })))[0]![0]).toBe(t.approvePr);
  expect((await sent(card({ need: 'review', noChange: true })))[0]![0]).toBe(t.approveNoChange);
  expect((await sent(card({ need: 'review', contribution: { number: 7 } as Item['contribution'] })))[0]![0]).toBe(t.review.merge(7));
});

test('a reply that sets work in motion waits out its undo; keeping a card does not', () => {
  expect(quickReplies(card({ need: 'demo' }), repo()).every((r) => r.held)).toBe(true);
  const superseded = quickReplies(card({ superseded: { why: 'x' } as Item['superseded'] }), repo());
  expect(superseded.map((r) => [r.label, !!r.held, !!r.undo])).toEqual([
    [t.superseded.keep, false, false],
    [t.superseded.remove, false, true],
  ]);
});

test('a single question of few options is answered by them; only the agent’s pick is primary', async () => {
  const r = await sent(card({ need: 'question', question: { text: 'Which?', options: ['A', 'B'], pick: { options: ['B'], why: 'x' } } }));
  expect(r.map(([label, , primary]) => [label, primary])).toEqual([
    ['A', false],
    ['B', true],
  ]);
  expect(r[0]![1]).toMatchObject({ action: 'answer', picks: ['A'] });
});

test('a choice of several or of many options is made on the card', () => {
  expect(quickReplies(card({ need: 'question', question: { text: '?', options: ['1', '2', '3', '4', '5'] } }))).toEqual([]);
  expect(quickReplies(card({ need: 'question', question: { text: '?', options: ['a', 'b'], multiple: true } }))).toEqual([]);
});

test('a proposal is accepted or dismissed, but not accepted blind when it asks, nor while it is reworked', async () => {
  expect((await sent(card({ state: 'proposal', proposal: { questions: [] } as unknown as Item['proposal'] }))).map(([, a]) => (a as CardAction).action)).toEqual(['accept', 'dismiss']);
  const asks = card({ state: 'proposal', proposal: { questions: [{ text: '?', options: ['a', 'b'] }] } as unknown as Item['proposal'] });
  expect((await sent(asks)).map(([, a]) => (a as CardAction).action)).toEqual(['dismiss']);
  expect(quickReplies(card({ state: 'proposal', proposal: { revising: true } as unknown as Item['proposal'] }))).toEqual([]);
});

test('what only the card can settle has no reply', () => {
  expect(quickReplies(card({ state: 'inPr' }))).toEqual([]);
  expect(quickReplies(card({ state: 'idea' }))).toEqual([]);
  expect(quickReplies(card({ need: 'demo', landing: true } as Partial<Item>))).toEqual([]);
});
