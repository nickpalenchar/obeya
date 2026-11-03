import { afterEach, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { CodexRpcError, type CodexConnection, type CodexHandlers } from './codex-rpc';
import { codexSandbox, createCodexRuntime, projectTrust } from './codex-runtime';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { gitRepo } from './testing';
import { git } from './workspaces';
import type { AgentEvent, AgentSession, AgentSpec } from './runtime';

const model = { model: 'codex-test', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'high' }], inputModalities: ['text', 'image'] };
class Wire implements CodexConnection {
  readonly pid = 12345;
  calls: { method: string; params: Record<string, unknown> }[] = [];
  notifications: string[] = [];
  closed = false;
  handlers!: CodexHandlers;
  n = 0;
  done: Promise<void>;
  finish!: () => void;
  override?: (method: string, params: Record<string, unknown>) => Promise<unknown> | undefined;
  constructor() { this.done = new Promise((r) => { this.finish = r; }); }
  async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
    this.calls.push({ method, params });
    const overridden = this.override?.(method, params);
    if (overridden) return await overridden as T;
    if (method === 'model/list') return { data: [model], nextCursor: null } as T;
    if (method === 'thread/start' || method === 'thread/resume') return { thread: { id: 'thread-1' }, model: model.model } as T;
    if (method === 'thread/backgroundTerminals/list') return { data: [], nextCursor: null } as T;
    if (method === 'turn/start') {
      const turn = { id: `turn-${++this.n}`, status: 'inProgress' };
      this.handlers.notification('turn/started', { threadId: 'thread-1', turn });
      return { turn } as T;
    }
    if (method === 'turn/steer') return { turnId: params.expectedTurnId } as T;
    return {} as T;
  }
  notify(method: string) { this.notifications.push(method); }
  close() { this.closed = true; this.finish(); }
  complete(id = `turn-${this.n}`, status = 'completed', error: unknown = null) {
    this.handlers.notification('turn/completed', { threadId: 'thread-1', turn: { id, status, error } });
  }
  server(method: string, params: Record<string, unknown> = {}) {
    return this.handlers.request(method, { threadId: 'thread-1', turnId: `turn-${this.n}`, ...params });
  }
}
const sessions: AgentSession[] = [];
afterEach(async () => { for (const s of sessions.splice(0)) { s.close(); await s.done; } });
async function until(check: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!check()) { if (Date.now() > deadline) throw new Error('Timed out waiting for Codex contract event'); await Bun.sleep(1); }
}
function fixture(overrides: Partial<AgentSpec> = {}, wire = new Wire(), first: string | null = 'start') {
  const events: AgentEvent[] = [];
  const runtime = createCodexRuntime((_spec, handlers) => { wire.handlers = handlers; return wire; });
  const spec: AgentSpec = { cwd: tmpdir(), system: 'Obeya instructions', tools: [], onEvent: (e) => events.push(e), ...overrides };
  const session = runtime.start(spec, first ?? undefined);
  sessions.push(session);
  return { wire, session, events };
}

test('handshake enables experimental tools; model is discovered and names normalize at dispatch', async () => {
  const calls: unknown[] = [];
  const { wire, events } = fixture({ effort: 'high', tools: [{ name: 'report', description: 'Report', schema: { text: z.string() }, run: (args) => { calls.push(args); return 'recorded'; } }] });
  await until(() => wire.n === 1);
  expect(wire.calls[0]).toEqual({ method: 'initialize', params: { clientInfo: { name: 'obeya', title: 'Obeya', version: '0.1.0' }, capabilities: { experimentalApi: true } } });
  expect(wire.notifications).toEqual(['initialized']);
  const start = wire.calls.find((c) => c.method === 'thread/start')!;
  expect(start.params).toMatchObject({ cwd: tmpdir(), developerInstructions: 'Obeya instructions', model: 'codex-test', approvalPolicy: 'on-request', sandbox: 'workspace-write', dynamicTools: [{ type: 'function', name: 'obeya_report' }] });
  expect(events[0]).toEqual({ type: 'session', id: 'codex:thread-1' });
  const result = await wire.server('item/tool/call', { callId: 'c1', namespace: null, tool: 'obeya_report', arguments: { text: 'done' } });
  expect(result).toEqual({ contentItems: [{ type: 'inputText', text: 'recorded' }], success: true });
  expect(calls).toEqual([{ text: 'done' }]);
  expect(events.at(-1)).toEqual({ type: 'tool', name: 'mcp__obeya__report', input: { text: 'done' } });
});

test('tools validate strict arguments, reject other thread/turn/namespace, and deduplicate a call', async () => {
  let runs = 0;
  const { wire } = fixture({ tools: [{ name: 'report', description: '', schema: { count: z.number().int() }, run: () => { runs++; return 'ok'; } }] });
  await until(() => wire.n === 1);
  const call = { namespace: null, tool: 'obeya_report', arguments: { count: 1 } };
  for (const [callId, arguments_] of [['bad', { count: '1' }], ['extra', { count: 1, injected: true }]] as const) {
    expect(await wire.server('item/tool/call', { ...call, callId, arguments: arguments_ })).toMatchObject({ success: false });
  }
  expect(await wire.server('item/tool/call', { ...call, callId: 'namespace', namespace: 'other' })).toMatchObject({ success: false });
  await expect(wire.server('item/tool/call', { ...call, callId: 'wrong', threadId: 'another' })).rejects.toThrow('active Obeya thread');
  await expect(wire.server('item/tool/call', { ...call, callId: 'wrong', turnId: 'another' })).rejects.toThrow('active Obeya thread');
  const results = await Promise.all([wire.server('item/tool/call', { ...call, callId: 'good' }), wire.server('item/tool/call', { ...call, callId: 'good' })]);
  expect(results[0]).toEqual(results[1]);
  expect(runs).toBe(1);
});

test('queues initial messages and images, steers while active, and waits for authoritative completion', async () => {
  const { wire, session, events } = fixture({}, new Wire(), null);
  session.send('first', [join(tmpdir(), 'screen.png')]);
  session.send('second');
  await until(() => wire.calls.some((c) => c.method === 'turn/steer'));
  expect(wire.calls.find((c) => c.method === 'turn/start')?.params.input).toEqual([{ type: 'text', text: 'first', text_elements: [] }, { type: 'localImage', path: join(tmpdir(), 'screen.png') }]);
  wire.handlers.notification('item/agentMessage/delta', { threadId: 'other', turnId: 'turn-1', delta: 'wrong' });
  wire.handlers.notification('item/agentMessage/delta', { threadId: 'thread-1', turnId: 'turn-1', delta: 'hello' });
  wire.handlers.notification('error', { threadId: 'thread-1', turnId: 'turn-1', willRetry: true, error: { message: 'retrying' } });
  wire.handlers.notification('item/completed', { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'agentMessage', text: 'hello' } });
  expect(events.filter((e) => e.type === 'text')).toEqual([{ type: 'text', text: 'hello' }]);
  expect(events.some((e) => e.type === 'idle' || e.type === 'error')).toBe(false);
  wire.complete();
  await until(() => events.some((e) => e.type === 'idle'));
  session.send('owner answer');
  await until(() => wire.n === 2);
});

test('completion before start reply does not resurrect a finished turn', async () => {
  const wire = new Wire();
  wire.override = (method) => {
    if (method !== 'turn/start') return;
    wire.n++;
    wire.handlers.notification('turn/started', { threadId: 'thread-1', turn: { id: `turn-${wire.n}`, status: 'inProgress' } });
    wire.complete();
    return Promise.resolve({ turn: { id: `turn-${wire.n}` } });
  };
  const { events, session } = fixture({}, wire);
  await until(() => events.some((e) => e.type === 'idle'));
  session.send('next');
  await until(() => wire.n === 2);
  expect(wire.calls.filter((c) => c.method === 'turn/steer')).toHaveLength(0);
});

test('a rejected steering/completion race queues input exactly once for a new turn', async () => {
  const wire = new Wire();
  wire.override = (method) => {
    if (method !== 'turn/steer') return;
    wire.complete();
    return Promise.reject(new CodexRpcError(-32600, 'No active turn'));
  };
  const { session, events } = fixture({}, wire);
  await until(() => wire.n === 1);
  session.send('late owner message');
  await until(() => wire.n === 2);
  expect(wire.calls.filter((c) => c.method === 'turn/start').map((c) => c.params.input)).toEqual([[{ type: 'text', text: 'start', text_elements: [] }], [{ type: 'text', text: 'late owner message', text_elements: [] }]]);
  expect(events.some((e) => e.type === 'error')).toBe(false);
});

test('an ambiguous steering failure closes without replaying accepted input', async () => {
  const wire = new Wire();
  wire.override = (method) => method === 'turn/steer' ? Promise.reject(new Error('transport dropped after acceptance')) : undefined;
  const { session, events } = fixture({}, wire);
  await until(() => wire.n === 1);
  session.send('do not duplicate');
  await session.done;
  expect(wire.n).toBe(1);
  expect(events).toContainEqual({ type: 'error', message: 'transport dropped after acceptance', ended: true });
});

test('resume preserves harness ownership and relies on Codex restoring persisted tools', async () => {
  const { wire } = fixture({ resume: 'codex:thread-1' });
  await until(() => wire.n === 1);
  expect(wire.calls.find((c) => c.method === 'thread/resume')?.params).toMatchObject({ threadId: 'thread-1' });
  expect(wire.calls.some((c) => c.method === 'thread/start')).toBe(false);
  expect(wire.calls.find((c) => c.method === 'thread/resume')?.params).not.toHaveProperty('dynamicTools');
  expect(() => fixture({ resume: 'claude-session' })).toThrow('codex: session');
  expect(() => fixture({ resume: 'pi:session' })).toThrow('codex: session');
});

test('permission defaults to deny; unsupported grants and native questions fail closed', async () => {
  const { wire, events } = fixture();
  await until(() => wire.n === 1);
  expect(await wire.server('item/commandExecution/requestApproval', { command: 'touch outside' })).toEqual({ decision: 'decline' });
  expect(await wire.server('item/fileChange/requestApproval', { grantRoot: '/outside' })).toEqual({ decision: 'decline' });
  expect(await wire.server('item/permissions/requestApproval')).toEqual({ permissions: {}, scope: 'turn' });
  await expect(wire.server('item/tool/requestUserInput')).rejects.toThrow('use the Obeya tools');
  expect(events.filter((e) => e.type === 'denied')).toHaveLength(3);
  expect(events.filter((e) => e.type === 'denied').every((e) => e.by === 'mode')).toBe(true);
});

test('permission identity survives new turn/item ids but keeps command and permission scope', async () => {
  const requests: Record<string, unknown>[] = [];
  const { wire } = fixture({ askOwner: async (r) => { requests.push(r.input); return { allow: false, message: 'Denied for the test' }; } });
  await until(() => wire.n === 1);
  await wire.server('item/commandExecution/requestApproval', { itemId: 'old', command: 'preview', cwd: '/repo', additionalPermissions: { network: true } });
  wire.complete();
  wire.n = 2; wire.handlers.notification('turn/started', { threadId: 'thread-1', turn: { id: 'turn-2', status: 'inProgress' } });
  await wire.server('item/commandExecution/requestApproval', { itemId: 'new', command: 'preview', cwd: '/repo', additionalPermissions: { network: true }, reason: 'new reason' });
  expect(requests[0]).toEqual(requests[1]);
  expect(requests[1]).toEqual({ command: 'preview', cwd: '/repo', additionalPermissions: { network: true } });
});

test('owner denial is attributed to the owner, not the foreground sleep hook', async () => {
  const { wire, events } = fixture({ askOwner: async () => ({ allow: false, message: 'No server' }) });
  await until(() => wire.n === 1);
  expect(await wire.server('item/commandExecution/requestApproval')).toEqual({ decision: 'decline' });
  expect(events).toContainEqual(expect.objectContaining({ type: 'denied', by: 'owner', reason: 'No server' }));
});

test('owner permits only the individual action and a pending permission aborts on close', async () => {
  const { wire } = fixture({ askOwner: async () => ({ allow: true }) });
  await until(() => wire.n === 1);
  expect(await wire.server('item/commandExecution/requestApproval', { availableDecisions: ['accept', 'acceptForSession'] })).toEqual({ decision: 'accept' });
  expect(await wire.server('item/commandExecution/requestApproval', { availableDecisions: ['acceptForSession'] })).toEqual({ decision: 'decline' });
  // a granted network request is that command's network alone: no session-wide host, no amendment
  const network = { command: 'pnpm install', networkApprovalContext: { host: 'registry.npmjs.org', protocol: 'https' }, proposedNetworkPolicyAmendments: [{ host: 'registry.npmjs.org', action: 'allow' }] };
  const offered = ['accept', 'acceptForSession', { applyNetworkPolicyAmendment: { network_policy_amendment: { host: 'registry.npmjs.org', action: 'allow' } } }, 'cancel'];
  expect(await wire.server('item/commandExecution/requestApproval', { ...network, availableDecisions: offered })).toEqual({ decision: 'accept' });
  let signal: AbortSignal | undefined;
  const second = fixture({ askOwner: async (_r, s) => { signal = s; return new Promise((resolve) => s.addEventListener('abort', () => resolve({ allow: false, message: 'closed' }))); } });
  await until(() => second.wire.n === 1);
  const permission = second.wire.server('item/commandExecution/requestApproval');
  await until(() => signal !== undefined);
  second.session.close();
  expect(signal!.aborted).toBe(true);
  expect(await permission).toEqual({ decision: 'decline' });
  await second.session.done;
  expect(second.wire.calls.map((c) => c.method).slice(-2)).toEqual(['turn/interrupt', 'thread/backgroundTerminals/clean']);
});

test('background terminals hold idle and wake a new inspection turn when they end', async () => {
  const wire = new Wire();
  let running = true;
  wire.override = (method) => method === 'thread/backgroundTerminals/list' ? Promise.resolve({ data: running ? [{ itemId: 'bg1', command: 'build' }] : [], nextCursor: null }) : undefined;
  const { events } = fixture({}, wire);
  await until(() => wire.n === 1);
  wire.complete();
  await until(() => events.some((e) => e.type === 'idle'));
  expect(events).toContainEqual({ type: 'background', tasks: [{ id: 'bg1', description: 'build' }] });
  expect(events).toContainEqual({ type: 'idle', background: 1, more: false });
  running = false;
  await until(() => wire.n === 2);
  expect(events).toContainEqual({ type: 'background', tasks: [] });
  expect(events).toContainEqual({ type: 'idle', background: 0, more: true });
});

test('a usage limit is a failed turn, never a transient notification or model substitution', async () => {
  const { wire, events } = fixture();
  await until(() => wire.n === 1);
  wire.complete('turn-1', 'failed', { message: 'out of allowance', codexErrorInfo: 'usageLimitExceeded' });
  await until(() => events.some((e) => e.type === 'idle'));
  expect(events).toContainEqual({ type: 'error', message: 'out of allowance', limit: {} });
});

test('unknown model, unsupported effort and substitution fail explicitly before doing work', async () => {
  for (const overrides of [{ model: 'opus' }, { effort: 'max' as const }]) {
    const { wire, session, events } = fixture(overrides);
    await session.done;
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(wire.calls.some((c) => c.method.startsWith('thread/'))).toBe(false);
  }
  const wire = new Wire();
  wire.override = (method) => method === 'thread/start' ? Promise.resolve({ thread: { id: 'other' }, model: 'silent-fallback' }) : undefined;
  const { events, session } = fixture({}, wire);
  await session.done;
  expect(events).toContainEqual({ type: 'error', message: 'Codex substituted model silent-fallback for codex-test', ended: true });
});

test('unsupported safety contracts fail before spawning a subprocess', () => {
  const variants: Partial<AgentSpec>[] = [
    { cwd: 'ssh://host/repo' }, { readOnly: true }, { untrusted: true }, { plugins: ['/plugin'] },
    { dirs: ['relative-root'] }, { env: { PATH: '/session-programs' } }, { env: { Path: 'C:\\session-programs' } }, { watch: { before: async () => {}, after: async () => {} } }, { permissionMode: 'auto' },
  ];
  for (const variant of variants) expect(() => fixture(variant)).toThrow('does not support');
});

test('portable roots, resolved model pinning and context updates use native protocol boundaries', async () => {
  let update = 'Owner changed the requirements';
  const { wire, events } = fixture({ dirs: ['/plans'], setting: { model: 'opus', effort: 'high', harness: 'codex' }, contextUpdate: () => { const text = update; update = ''; return text; }, tools: [{ name: 'report', description: '', schema: {}, run: () => 'recorded' }] });
  await until(() => wire.n === 1);
  expect(wire.calls.find((c) => c.method === 'thread/start')?.params.config).toEqual({ 'sandbox_workspace_write.writable_roots': ['/plans'], 'shell_environment_policy.set': { OBEYA_AGENT_PID: '12345' } });
  expect(events[0]).toMatchObject({ type: 'session', setting: { harness: 'codex', codex: { model: 'codex-test', effort: 'high' } } });
  expect(await wire.server('item/tool/call', { callId: 'ctx', namespace: null, tool: 'obeya_report', arguments: {} })).toMatchObject({ contentItems: [{ type: 'inputText', text: 'recorded\n\nOwner changed the requirements' }] });
  update = 'Pause requested';
  wire.handlers.notification('item/completed', { threadId: 'thread-1', turnId: 'turn-1', item: { type: 'commandExecution' } });
  await until(() => wire.calls.some((c) => c.method === 'turn/steer'));
  expect(wire.calls.find((c) => c.method === 'turn/steer')?.params.input).toEqual([{ type: 'text', text: 'Pause requested', text_elements: [] }]);
});

test('closing during initialization does not start a thread or emit a late event', async () => {
  const wire = new Wire();
  let release!: () => void;
  wire.override = (method) => method === 'initialize' ? new Promise((resolve) => { release = () => resolve({}); }) : undefined;
  const { session, events } = fixture({}, wire);
  session.close();
  release();
  await session.done;
  expect(wire.calls.map((c) => c.method)).toEqual(['initialize']);
  expect(events).toEqual([]);
});

test('background cleanup still runs if interrupt loses the completion race', async () => {
  const wire = new Wire();
  wire.override = (method) => method === 'turn/interrupt' ? Promise.reject(new CodexRpcError(-32600, 'No active turn')) : undefined;
  const { session } = fixture({}, wire);
  await until(() => wire.n === 1);
  session.close();
  await session.done;
  expect(wire.calls.map((c) => c.method).slice(-2)).toEqual(['turn/interrupt', 'thread/backgroundTerminals/clean']);
});

test('stuck semantic cleanup is bounded independently of the normal RPC timeout', async () => {
  const wire = new Wire();
  wire.override = (method) => method === 'thread/backgroundTerminals/clean' ? new Promise(() => {}) : undefined;
  const { session } = fixture({}, wire);
  await until(() => wire.n === 1);
  const start = Date.now();
  session.close();
  await session.done;
  expect(wire.closed).toBe(true);
  expect(Date.now() - start).toBeLessThan(2000);
});

test('permission identity ignores RPC timestamps and callback ids, never changes authority', async () => {
  const inputs: Record<string, unknown>[] = [];
  const { wire } = fixture({ askOwner: async (r) => { inputs.push(r.input); return { allow: false, message: 'No' }; } });
  await until(() => wire.n === 1);
  await wire.server('item/commandExecution/requestApproval', { command: 'preview', cwd: '/repo', startedAtMs: 1, approvalId: 'old', additionalPermissions: { network: true } });
  await wire.server('item/commandExecution/requestApproval', { command: 'preview', cwd: '/repo', startedAtMs: 2, approvalId: 'new', additionalPermissions: { network: true } });
  await wire.server('item/commandExecution/requestApproval', { command: 'preview', cwd: '/repo', startedAtMs: 3, approvalId: 'new', additionalPermissions: { network: false } });
  expect(inputs[0]).toEqual(inputs[1]);
  expect(inputs[0]).not.toEqual(inputs[2]);
});

test('one-action owner approvals never grant a session-wide outside root', async () => {
  let asked = false;
  const { wire } = fixture({ askOwner: async () => { asked = true; return { allow: true }; } });
  await until(() => wire.n === 1);
  expect(await wire.server('item/fileChange/requestApproval', { grantRoot: '/outside' })).toEqual({ decision: 'decline' });
  expect(asked).toBe(false);
});

test('turn interruption and server resolution abort and settle the outstanding permission', async () => {
  const signals: AbortSignal[] = [];
  const { wire } = fixture({ askOwner: async (_r, signal) => {
    signals.push(signal);
    return new Promise((resolve) => signal.addEventListener('abort', () => resolve({ allow: false, message: 'Ended' }), { once: true }));
  } });
  await until(() => wire.n === 1);
  const params = { threadId: 'thread-1', turnId: 'turn-1', command: 'preview' };
  const first = wire.handlers.request('item/commandExecution/requestApproval', params, 'request-1');
  await until(() => signals.length === 1);
  wire.handlers.notification('serverRequest/resolved', { threadId: 'thread-1', requestId: 'request-1' });
  expect(await first).toEqual({ decision: 'decline' });
  expect(signals[0]!.reason).toBe('permission-obsolete');
  const second = wire.handlers.request('item/commandExecution/requestApproval', params, 'request-2');
  await until(() => signals.length === 2);
  wire.complete('turn-1', 'interrupted');
  expect(await second).toEqual({ decision: 'decline' });
  expect(signals[1]!.aborted).toBe(true);
  expect(wire.calls.filter((c) => c.method === 'turn/steer')).toHaveLength(0);
});

test('denial forwards the owner alternative as model input, not just an audit line', async () => {
  const alternative = 'Create a new commit instead of force-pushing.';
  const { wire } = fixture({ askOwner: async () => ({ allow: false, message: alternative }) });
  await until(() => wire.n === 1);
  expect(await wire.server('item/commandExecution/requestApproval', { command: 'git push --force' })).toEqual({ decision: 'decline' });
  await until(() => wire.calls.some((c) => c.method === 'turn/steer'));
  expect(JSON.stringify(wire.calls.filter((c) => c.method === 'turn/steer'))).toContain(alternative);
});

test('a completed build wakes Codex while a server stays; unchanged polls do not emit idle', async () => {
  let tasks = [{ itemId: 'server', command: 'serve', osPid: 5678 }, { itemId: 'build', command: 'build', osPid: 5679 }];
  const pids: number[][] = [];
  const wire = new Wire();
  Object.assign(wire, { trackProcesses: (ids: number[]) => pids.push(ids) });
  wire.override = (method) => method === 'thread/backgroundTerminals/list' ? Promise.resolve({ data: tasks, nextCursor: null }) : undefined;
  const { events } = fixture({}, wire);
  await until(() => wire.n === 1);
  wire.complete();
  await until(() => events.some((e) => e.type === 'idle'));
  await Bun.sleep(1100);
  expect(events.filter((e) => e.type === 'idle')).toHaveLength(1);
  tasks = tasks.slice(0, 1);
  await until(() => wire.n === 2);
  expect(JSON.stringify(wire.calls.filter((c) => c.method === 'turn/start'))).toContain('build');
  expect(pids[0]).toEqual([5678, 5679]);
});

test('the sandbox is workspace-write unless OBEYA_CODEX_SANDBOX lifts it', () => {
  const warn = console.warn;
  const said: string[] = [];
  console.warn = (m: string) => { said.push(m); };
  try {
    expect(codexSandbox({})).toBe('workspace-write');
    expect(codexSandbox({ OBEYA_CODEX_SANDBOX: 'workspace-write' })).toBe('workspace-write');
    expect(said).toEqual([]);
    expect(codexSandbox({ OBEYA_CODEX_SANDBOX: 'danger-full-access' })).toBe('danger-full-access');
    // anything else keeps the sandbox, and says so
    expect(codexSandbox({ OBEYA_CODEX_SANDBOX: 'off' })).toBe('workspace-write');
    expect(codexSandbox({ OBEYA_CODEX_SANDBOX: 'read-only' })).toBe('workspace-write');
    expect(said.filter((m) => m.includes('neither'))).toHaveLength(2);
  } finally {
    console.warn = warn;
  }
});

test('a worker starts its Codex thread without the sandbox where the environment says so', async () => {
  const was = process.env.OBEYA_CODEX_SANDBOX;
  const warn = console.warn;
  console.warn = () => {};
  process.env.OBEYA_CODEX_SANDBOX = 'danger-full-access';
  try {
    const { wire } = fixture();
    await until(() => wire.n === 1);
    expect(wire.calls.find((c) => c.method === 'thread/start')?.params).toMatchObject({ sandbox: 'danger-full-access', approvalPolicy: 'on-request' });
  } finally {
    console.warn = warn;
    if (was === undefined) delete process.env.OBEYA_CODEX_SANDBOX;
    else process.env.OBEYA_CODEX_SANDBOX = was;
  }
});

test("a start ends before any thread where Codex would load repository configuration the owner has not trusted", async () => {
  const layer = (folder: string, disabledReason: string | null = null) => ({ name: { type: 'project', dotCodexFolder: folder }, config: {}, version: '1', disabledReason });
  const own = join(tmpdir(), '.codex');
  for (const [codexConfig, layers, ok] of [
    [false, [layer(own, 'untrusted'), { name: { type: 'user', file: '/u' }, config: {}, version: '1' }], true],
    [false, [layer(own)], false],
    [true, [layer(own)], true],
    [true, [layer(join(tmpdir(), 'nested', '.codex'))], false],
  ] as const) {
    const wire = new Wire();
    wire.override = (method) => (method === 'config/read' ? Promise.resolve({ config: {}, origins: {}, layers }) : undefined);
    const { events } = fixture({ codexConfig }, wire);
    await until(() => events.length > 0);
    expect(wire.calls.find((c) => c.method === 'config/read')!.params).toEqual({ cwd: tmpdir(), includeLayers: true });
    if (ok) expect(events[0]).toMatchObject({ type: 'session' });
    else {
      expect(events[0]).toMatchObject({ type: 'error', message: expect.stringContaining('repository configuration the owner has not trusted'), ended: true });
      expect(wire.calls.some((c) => c.method === 'thread/start')).toBe(false);
    }
  }
});

test("Codex is told the trust of the project by its checkout and, from a linked worktree, by the main checkout", () => {
  const dir = mkdtempSync(join(tmpdir(), 'obeya-codex-roots-'));
  try {
    const repo = gitRepo(join(dir, 'repo'));
    git(repo, 'worktree', 'add', '--quiet', '-b', 'card', join(dir, 'ws'));
    const [r, w] = [realpathSync(repo), realpathSync(join(dir, 'ws'))];
    expect(projectTrust(repo, true)).toBe(`projects={${JSON.stringify(r)}={trust_level="trusted"}}`);
    expect(projectTrust(join(dir, 'ws'), false)).toBe(`projects={${JSON.stringify(w)}={trust_level="untrusted"},${JSON.stringify(r)}={trust_level="untrusted"}}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
