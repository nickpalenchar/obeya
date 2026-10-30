import { afterEach, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { CodexRpcError, type CodexConnection, type CodexHandlers } from './codex-rpc';
import { createCodexRuntime } from './codex-runtime';
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
  expect(events).toContainEqual({ type: 'error', message: 'transport dropped after acceptance' });
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
  expect(events).toContainEqual({ type: 'error', message: 'Codex substituted model silent-fallback for codex-test' });
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
