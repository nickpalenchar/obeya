import { expect, test } from 'bun:test';
import { generic } from '../adapters/generic';
import { AGENT_DEFAULTS, type AgentSetting } from '../core/types';
import { Workers } from './workers';
import { board, eachTest, flush, manual, runtime, setWorkers, spaces, workers } from './workers-fixture';

eachTest();
const codex: AgentSetting = { ...AGENT_DEFAULTS.worker, harness: 'codex', codex: { model: 'test-codex', effort: 'low' } };
function using(choice: () => AgentSetting) {
  setWorkers(new Workers({ board, runtime, workspaces: spaces, adapter: { ...generic, workspaces: 'clones', land: 'main' }, agentSetting: choice }));
}

test('pins before first session id and resumes the same harness after settings change and server restart', async () => {
  let choice = codex;
  using(() => choice);
  const card = manual();
  await workers.start(card.id);
  expect(JSON.parse(board.row(card.id).agent_setting!)).toEqual(codex);
  const resolved: AgentSetting = { ...codex, codex: { model: 'resolved-account-default', effort: 'low' } };
  runtime.last.emit({ type: 'session', id: 'codex:thread-1', setting: resolved });
  expect(JSON.parse(board.row(card.id).agent_setting!)).toEqual(resolved);
  workers.shutdown(); await flush();
  choice = AGENT_DEFAULTS.worker;
  using(() => choice); workers.resumeAll();
  expect(runtime.last.spec).toMatchObject({ resume: 'codex:thread-1', setting: resolved });
  workers.shutdown();
});

test('legacy session is Claude even when new worker default is Codex', async () => {
  const card = manual(); await workers.start(card.id);
  runtime.last.emit({ type: 'session', id: 'legacy-session' });
  workers.shutdown(); await flush();
  board.work(card.id, { agent_setting: null });
  using(() => codex); workers.resumeAll();
  expect(runtime.last.spec.resume).toBe('legacy-session');
  expect(runtime.last.spec.setting?.harness).toBeUndefined();
  expect(JSON.parse(board.row(card.id).agent_setting!).harness).toBeUndefined();
  workers.shutdown();
});

test('a worker restarted deliberately takes the new default instead of its old harness', async () => {
  using(() => codex); const card = manual(); await workers.start(card.id);
  runtime.last.emit({ type: 'session', id: 'codex:thread-1' });
  await workers.stop(card.id); await workers.freed();
  using(() => AGENT_DEFAULTS.worker); await workers.start(card.id);
  expect(runtime.last.spec.resume).toBeUndefined();
  expect(runtime.last.spec.setting).toEqual(AGENT_DEFAULTS.worker);
  workers.shutdown();
});
