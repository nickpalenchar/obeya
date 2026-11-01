import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentSetting } from '../core/types';
import { Store } from './db';
import { withAgentSetting } from './runtime';
import { FakeRuntime } from './testing';
import { agentIdentity, currentAgent } from './agent-identity';

test('concurrent sessions record resolved speaker snapshots, never current defaults or another session', async () => {
  const store = new Store(':memory:');
  store.ensureCanvas('c', 'C');
  const [a, b] = store.insert([{ canvas_id: 'c', kind: 'task', x: 0, y: 0 }, { canvas_id: 'c', kind: 'task', x: 1, y: 0 }]);
  const fake = new FakeRuntime();
  let choice: AgentSetting = { model: 'opus', effort: 'high' };
  const runtime = withAgentSetting(fake, () => choice);
  const start = (cardId: string) => runtime.start({
    cwd: '.', system: '', role: 'worker',
    tools: [{ name: 'report', description: '', schema: {}, run: async () => {
      await Bun.sleep(1);
      store.addEvent({ cardId, kind: 'report', author: 'worker', text: 'Tool report' });
      store.addEvent({ cardId, kind: 'say', author: 'owner', text: 'Owner is not a model' });
      store.addEvent({ cardId, kind: 'report', author: 'obeya', text: 'System is not a model' });
      return 'ok';
    } }],
    onEvent: (e) => { if (e.type === 'text') store.addEvent({ cardId, kind: 'say', author: 'worker', text: e.text }); },
  });
  try {
    const first = start(a!.id);
    const claude = fake.last;
    choice = { model: 'opus', effort: 'high', harness: 'codex', codex: { model: 'default', effort: 'low' } };
    const second = start(b!.id);
    const codex = fake.last;
    claude.emit({ type: 'session', id: 'claude-1', model: 'claude-opus-resolved' });
    codex.emit({ type: 'session', id: 'codex:1', model: 'gpt-resolved' });
    claude.emit({ type: 'text', text: 'First' });
    codex.emit({ type: 'text', text: 'Second' });
    choice = { model: 'haiku', effort: 'low' };
    await Promise.all([claude.call('report', {}), codex.call('report', {})]);
    const eventsA = store.events(a!.id), eventsB = store.events(b!.id);
    for (const e of eventsA.filter((e) => e.author === 'worker')) expect(e.agent).toEqual({ harness: 'claude', model: 'claude-opus-resolved' });
    for (const e of eventsB.filter((e) => e.author === 'worker')) expect(e.agent).toEqual({ harness: 'codex', model: 'gpt-resolved' });
    for (const e of [...eventsA, ...eventsB].filter((e) => e.author !== 'worker')) expect(e.agent).toBeUndefined();
    expect(currentAgent()).toBeUndefined();
    first.close(); second.close();
  } finally { store.db.close(); }
});

test('speaker metadata survives a database reopen; reply and researched answer can have different models', () => {
  const root = mkdtempSync(join(tmpdir(), 'obeya-speakers-'));
  const path = join(root, 'db');
  let store = new Store(path);
  try {
    store.ensureCanvas('c', 'C');
    const [card] = store.insert([{ canvas_id: 'c', kind: 'task', x: 0, y: 0 }]);
    store.addEvent({ cardId: card!.id, kind: 'say', author: 'worker', text: 'Old unknown speaker' });
    const talk = store.addTalk('c', 'Question', '', null);
    agentIdentity.run({ harness: 'claude', model: 'opus' }, () => store.replyTalk(talk, 'Looking it up'));
    agentIdentity.run({ harness: 'codex', model: 'gpt-research' }, () => {
      store.answerTalk(talk, 'Research result', 'project');
      store.addEvent({ cardId: card!.id, kind: 'say', author: 'worker', text: 'Recorded' });
    });
    store.db.close(); store = new Store(path);
    expect(store.talk('c')[0]).toMatchObject({ replyAgent: { harness: 'claude', model: 'opus' }, answerAgent: { harness: 'codex', model: 'gpt-research' } });
    expect(store.events(card!.id).find((e) => e.text === 'Recorded')!.agent).toEqual({ harness: 'codex', model: 'gpt-research' });
    expect(store.events(card!.id).find((e) => e.text === 'Old unknown speaker')!.agent).toBeUndefined();
  } finally { store.db.close(); rmSync(root, { recursive: true, force: true }); }
});
