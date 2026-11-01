import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

/** The `dirs` a worker with this setting starts with, the demos directory being `demos`. */
async function dirsWith(choice: AgentSetting, demos: () => string) {
  setWorkers(new Workers({ board, runtime, workspaces: spaces, adapter: { ...generic, workspaces: 'clones', land: 'main' }, agentSetting: () => choice, demoDirectory: demos }));
  await workers.start(manual().id);
  const dirs = runtime.last.spec.dirs;
  workers.shutdown();
  return dirs;
}

test('a Codex worker may write in the demos directory', async () => {
  const demos = mkdtempSync(join(tmpdir(), 'obeya-demos-'));
  try {
    expect(await dirsWith(codex, () => demos)).toEqual([demos]);
  } finally {
    rmSync(demos, { recursive: true, force: true });
  }
});

test('a demos directory that is not there yet is not offered as a place to write', async () => {
  expect(await dirsWith(codex, () => join(tmpdir(), 'obeya-demos-missing-dir'))).toBeUndefined();
});

test('a Claude worker gets no extra directory for the demos', async () => {
  const demos = mkdtempSync(join(tmpdir(), 'obeya-demos-'));
  try {
    expect(await dirsWith(AGENT_DEFAULTS.worker, () => demos)).toBeUndefined();
  } finally {
    rmSync(demos, { recursive: true, force: true });
  }
});
