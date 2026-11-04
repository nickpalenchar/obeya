import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CARD_SIZE, MERGED_SIZE, onCanvas, sizeOf } from '../core/layout';
import { type Item, mergeableWith, needsYou, openQuestions } from '../core/types';
import { CanvasRuntime } from './canvas';
import { Store } from './db';
import { FakeRuntime, gitRepo, noForge } from './testing';

let dir: string;
let main: string;
let store: Store;
let runtime: FakeRuntime;
let canvas: CanvasRuntime;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'obeya-merges-'));
  main = join(dir, 'main');
  gitRepo(main);
  store = new Store(':memory:');
  runtime = new FakeRuntime();
  canvas = new CanvasRuntime({ repos: [{ path: main, clones: 1 }] }, { store, home: dir, runtime, forge: noForge, commandDelayMs: 10, limitMargin: 10 });
});
afterEach(() => {
  canvas.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

const settle = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const board = () => canvas.board;
const merger = () => runtime.sessions.filter((s) => s.spec.tools.some((t) => t.name === 'merge_cards')).at(-1);

/** A proposal from the agent of "Export", with a question, and the owner's planned card it belongs with. */
function cards(): { p: Item; planned: Item } {
  const from = board().create({ title: 'Export', x: 0, y: 0 });
  const p = board().propose(from.id, { title: 'Check CSV umlauts', task: 'The CSV export writes umlauts wrongly.', questions: [{ text: 'Which encoding?', options: ['UTF-8', 'Latin-1'] }] });
  const planned = board().create({ title: 'Fix the CSV export', body: 'Dates in the CSV export are off by one day.', x: 900, y: 600 });
  return { p, planned };
}

describe('a proposal merged with another card', () => {
  test('an agent writes one card of both; approved, the other card takes it and the proposal goes', async () => {
    const { p, planned } = cards();
    expect(mergeableWith(board().item(p.id)!, board().item(planned.id)!)).toBe(true);
    canvas.act(p.id, { action: 'merge', with: planned.id });
    const m = merger()!;
    expect(m.spec.readOnly).toBe(true);
    expect(m.inbox[0]).toContain('The CSV export writes umlauts wrongly.');
    expect(m.inbox[0]).toContain('Dates in the CSV export are off by one day.');
    expect(m.inbox[0]).toContain('Which encoding?');

    // while the agent merges: the two show as one, and neither needs the owner
    let a = board().item(p.id)!;
    let b = board().item(planned.id)!;
    expect(a.proposal?.merge).toEqual({ with: planned.id });
    expect(b.mergingInto).toBe(p.id);
    expect(needsYou(a)).toBe(false);
    expect(openQuestions(a)).toEqual([]);
    expect(sizeOf(a, board().items())).toEqual([...MERGED_SIZE]);
    expect(onCanvas(board().items()).map((i) => i.id)).not.toContain(planned.id);
    expect(() => canvas.act(planned.id, { action: 'start' })).toThrow('merged with a proposal');
    expect(() => canvas.act(p.id, { action: 'accept' })).toThrow('merged with another card');

    m.call('merge_cards', { title: 'Fix the CSV export', task: 'The CSV export writes umlauts wrongly and dates off by one day. Fix both.' });
    m.emit({ type: 'idle' });
    await settle();
    a = board().item(p.id)!;
    expect(a.proposal?.merge).toEqual({ with: planned.id, title: 'Fix the CSV export', task: 'The CSV export writes umlauts wrongly and dates off by one day. Fix both.' });
    // the merged card waits for the owner, in „Braucht dich“
    expect(needsYou(a)).toBe(true);

    canvas.act(p.id, { action: 'approveMerge' });
    expect(board().item(p.id)).toBeUndefined();
    b = board().item(planned.id)!;
    expect(b.state).toBe('planned');
    expect(b.mergingInto).toBeUndefined();
    expect(b.title).toBe('Fix the CSV export');
    // the proposal's open question goes with the planned task's text
    expect(b.body).toStartWith('The CSV export writes umlauts wrongly and dates off by one day. Fix both.');
    expect(b.body).toContain('Which encoding? (UTF-8 / Latin-1)');
    expect({ x: b.x, y: b.y }).toEqual({ x: a.x, y: a.y });
    expect(board().events(planned.id).at(-1)?.text).toContain('Check CSV umlauts');
    // marked as merged, not as dismissed by the owner
    expect(board().removed('1970-01-01T00:00:00.000Z').map((r) => r.title)).not.toContain('Check CSV umlauts');
  });

  test('separated, both stay as they were, side by side where the two stood as one', async () => {
    const { p, planned } = cards();
    canvas.act(p.id, { action: 'merge', with: planned.id });
    const at = board().item(p.id)!;
    canvas.act(p.id, { action: 'separate' });
    const a = board().item(p.id)!;
    const b = board().item(planned.id)!;
    expect(a.proposal?.merge).toBeUndefined();
    expect(b.mergingInto).toBeUndefined();
    expect(b.body).toBe('Dates in the CSV export are off by one day.');
    expect(b.x).toBe(at.x + MERGED_SIZE[0] - CARD_SIZE.task[0]);
    expect(needsYou(a)).toBe(true);
    // the agent's late answer changes nothing any more
    merger()!.call('merge_cards', { title: 'x', task: 'y' });
    merger()!.emit({ type: 'idle' });
    await settle();
    expect(board().item(p.id)!.proposal?.merge).toBeUndefined();
  });

  test('two proposals merged: the other keeps the questions of both', async () => {
    const { p } = cards();
    const from = board().create({ title: 'Import', x: 0, y: 300 });
    const q = board().propose(from.id, { title: 'CSV import', task: 'Import CSV too.', questions: [{ text: 'Which separator?', options: [';', ','] }] });
    canvas.act(p.id, { action: 'merge', with: q.id });
    merger()!.call('merge_cards', { title: 'CSV in and out', task: 'Export and import CSV correctly.' });
    merger()!.emit({ type: 'idle' });
    await settle();
    canvas.act(p.id, { action: 'approveMerge' });
    const b = board().item(q.id)!;
    expect(b.state).toBe('proposal');
    expect(b.body).toBe('Export and import CSV correctly.');
    expect(b.proposal?.questions.map((x) => x.text)).toEqual(['Which separator?', 'Which encoding?']);
  });

  test('a card that was started, an idea, or the proposal itself cannot be merged with', () => {
    const { p, planned } = cards();
    const idea = board().create({ title: 'Think about exports', x: 0, y: 900, idea: true });
    expect(() => canvas.act(p.id, { action: 'merge', with: p.id })).toThrow();
    expect(() => canvas.act(p.id, { action: 'merge', with: idea.id })).toThrow('can no longer be merged');
    // a card merged with one proposal is not merged with a second
    const from = board().create({ title: 'Import', x: 0, y: 300 });
    const q = board().propose(from.id, { title: 'CSV import', task: 'Import CSV too.' });
    canvas.act(q.id, { action: 'merge', with: planned.id });
    expect(() => canvas.act(p.id, { action: 'merge', with: planned.id })).toThrow('can no longer be merged');
    canvas.act(q.id, { action: 'separate' });
    board().work(planned.id, { state: 'working' });
    expect(() => canvas.act(p.id, { action: 'merge', with: planned.id })).toThrow('can no longer be merged');
  });

  test('an agent that ends without a merged text leaves the reason, and the merge can be tried again', async () => {
    const { p, planned } = cards();
    canvas.act(p.id, { action: 'merge', with: planned.id });
    merger()!.emit({ type: 'idle' });
    await settle();
    expect(board().item(p.id)!.proposal?.merge?.failed).toBeDefined();
    const before = runtime.sessions.length;
    canvas.act(p.id, { action: 'merge', with: planned.id });
    expect(runtime.sessions.length).toBe(before + 1);
    expect(board().item(p.id)!.proposal?.merge).toEqual({ with: planned.id });
  });
});
