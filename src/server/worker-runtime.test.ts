import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AGENT_DEFAULTS } from '../core/types';
import { OBEYA_PLUGIN } from './demo';
import { withAgentSetting, type AgentEvent, type AgentSpec } from './runtime';
import { FakeRuntime, gitRepo } from './testing';
import { workerHarnessRuntime } from './worker-runtime';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function fixture(extra: Partial<AgentSpec> = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'obeya-harness-')); dirs.push(cwd);
  gitRepo(cwd);
  const claude = new FakeRuntime(), codex = new FakeRuntime();
  const events: AgentEvent[] = [];
  const spec: AgentSpec = { cwd, system: 'instructions', tools: [], role: 'worker', onEvent: (e) => events.push(e), ...extra };
  const runtime = withAgentSetting(workerHarnessRuntime(claude, codex), () => AGENT_DEFAULTS.worker);
  return { cwd, claude, codex, events, spec, runtime };
}
const setting = { model: 'opus', effort: 'high', harness: 'codex', codex: { model: 'codex-test', effort: 'low' } } as const;

test('routes pinned harness/model independently of current default, with portable bundled skills', () => {
  const { runtime, spec, claude, codex } = fixture({ setting, plugins: [OBEYA_PLUGIN], permissionMode: 'auto', contextUpdate: () => 'news' });
  runtime.start(spec, 'build');
  expect(claude.sessions).toHaveLength(0);
  expect(codex.last.spec).toMatchObject({ model: 'codex-test', effort: 'low', setting });
  expect(codex.last.spec.plugins).toBeUndefined();
  expect(codex.last.spec.permissionMode).toBeUndefined();
  expect(codex.last.spec.system).toContain(join(OBEYA_PLUGIN, 'skills', 'browser', 'SKILL.md'));
  expect(codex.last.toolStep()).toBe('news');
  runtime.start({ ...spec, setting: AGENT_DEFAULTS.worker, resume: 'legacy-claude' });
  expect(claude.last.spec.resume).toBe('legacy-claude');
});

test('mismatched session ownership and unsupported capabilities fail visibly without starting a harness', async () => {
  for (const extra of [
    { setting, resume: 'claude-id' }, { resume: 'codex:thread' },
    { setting, role: 'koordinator' as const }, { setting, plugins: ['/foreign'] },
    { setting, cwd: 'ssh://host/repo' }, { setting, permissionMode: 'bypassPermissions' as const },
    { setting, watch: { before: async () => {}, after: async () => {} } },
  ]) {
    const { runtime, spec, events, claude, codex } = fixture(extra);
    await runtime.start(spec, 'build').done;
    expect(events.map((e) => e.type)).toEqual(['error', 'idle']);
    expect(claude.sessions).toHaveLength(0); expect(codex.sessions).toHaveLength(0);
  }
});

test('rejects a bare local folder even when no watch hooks were supplied', async () => {
  const { runtime, spec, cwd, events, codex, claude } = fixture({ setting });
  rmSync(join(cwd, '.git'), { recursive: true, force: true });
  await runtime.start(spec).done;
  expect(events).toContainEqual(expect.objectContaining({ type: 'error', message: 'Codex workers currently require a local Git workspace' }));
  expect(codex.sessions).toHaveLength(0); expect(claude.sessions).toHaveLength(0);
});

test('an unavailable Codex backend never falls back to Claude (including record/replay)', async () => {
  const { spec, claude, events } = fixture({ setting });
  const runtime = workerHarnessRuntime(claude, { start() { throw new Error('Codex workers are not supported in record/replay mode'); } });
  await runtime.start(spec).done;
  expect(events.map((e) => e.type)).toEqual(['error', 'idle']);
  expect(claude.sessions).toHaveLength(0);
});

test("a repository's .codex no longer stops a Codex worker: whether Codex loads it is its trust's to say", async () => {
  const { runtime, spec, cwd, codex, events } = fixture({ setting });
  mkdirSync(join(cwd, '.codex'));
  runtime.start(spec, 'build');
  expect(codex.sessions).toHaveLength(1);
  expect(codex.last.spec.codexConfig).toBeUndefined();
  expect(events.filter((e) => e.type === 'error')).toEqual([]);
});
