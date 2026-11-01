// Experimental Codex app-server stdio transport. No credentials or HTTP API calls of our own.
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { z } from 'zod';
import { messageOf } from '../core/text';
import { OWN_GROUP } from './spawn';
import { AgentProcesses } from './agent-processes';

const running = new Map<() => void, { done: Promise<void>; force: () => void }>();
/** Ordinary shutdown waits for escalation; an explicit force signals without waiting. */
export async function endCodexHere(force = false) {
  const active = [...running];
  for (const [close, entry] of active) force ? entry.force() : close();
  if (!force) await Promise.allSettled(active.map(([, entry]) => entry.done));
}

export interface CodexHandlers {
  notification(method: string, params: Record<string, unknown>): void;
  request(method: string, params: Record<string, unknown>, requestId?: string | number): Promise<unknown>;
}

export interface CodexConnection {
  /** Local app-server process, for session-scoped browser lifetime. */
  readonly pid?: number;
  request<T = unknown>(method: string, params: Record<string, unknown>): Promise<T>;
  notify(method: string, params: Record<string, unknown>): void;
  close(): void;
  /** Native PTY process ids, while still attributable to this app-server. */
  trackProcesses?(pids: number[]): void;
  /** Rejects on transport failure; resolves after an intentional close and subprocess exit. */
  done: Promise<void>;
}

export class CodexRpcError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
    this.name = 'CodexRpcError';
  }
}

const envelope = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  method: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});

/** An argv override is for contract tests; the runtime uses the installed CLI (or OBEYA_CODEX). */
export function codexConnection(
  options: { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; timeoutMs?: number },
  handlers: CodexHandlers,
): CodexConnection {
  const child = spawn(options.command, options.args, { cwd: options.cwd, env: options.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: OWN_GROUP });
  const terminals = child.pid ? new AgentProcesses(child.pid) : undefined;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  let nextId = 0;
  let closing = false;
  let failure: Error | undefined;
  let stderr = '';
  let buffer = '';
  let terminate: ReturnType<typeof setTimeout> | undefined;
  let kill: ReturnType<typeof setTimeout> | undefined;
  let resolveDone!: () => void;
  let rejectDone!: (error: Error) => void;
  const done = new Promise<void>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  // Consumers still observe rejection through `done`, but startup failure cannot go unhandled.
  void done.catch(() => {});
  const decoder = new StringDecoder('utf8');

  function signal(which: NodeJS.Signals) {
    try {
      if (OWN_GROUP && child.pid) process.kill(-child.pid, which);
      else child.kill(which);
    } catch { /* already gone */ }
  }
  function rejectPending(error: Error) {
    for (const p of pending.values()) clearTimeout(p.timer), p.reject(error);
    pending.clear();
  }
  function close() {
    if (closing) return;
    try { terminals?.track(); } catch (error) { failure ??= new Error(messageOf(error)); }
    closing = true;
    rejectPending(new Error('Codex app-server connection closed'));
    // EOF lets Codex shut down its own terminals, including on Windows. Bound a stuck shutdown.
    child.stdin.end();
    terminate = setTimeout(() => signal('SIGTERM'), 1000);
    kill = setTimeout(() => signal('SIGKILL'), 2000);
  }
  function fail(error: Error) {
    if (closing) return;
    failure = error;
    rejectPending(error);
    close();
  }
  function write(message: unknown) {
    if (closing) throw new Error('Codex app-server connection closed');
    child.stdin.write(`${JSON.stringify(message)}\n`, (error) => { if (error) fail(error); });
  }
  function receive(line: string) {
    const m = envelope.parse(JSON.parse(line));
    if (m.method) {
      if (m.id === undefined) handlers.notification(m.method, m.params ?? {});
      else {
        const id = m.id;
        // Do not block the input stream on an owner question or tool: responses must keep flowing.
        void handlers.request(m.method, m.params ?? {}, id).then(
          (result) => { if (!closing) write({ id, result }); },
          (error: unknown) => { if (!closing) write({ id, error: { code: error instanceof CodexRpcError ? error.code : -32603, message: messageOf(error) } }); },
        ).catch((error: unknown) => fail(new Error(messageOf(error))));
      }
    } else if (typeof m.id === 'number') {
      const p = pending.get(m.id);
      if (!p) return; // a timed-out request's late reply
      pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.error) p.reject(new CodexRpcError(m.error.code, m.error.message));
      else if ('result' in m) p.resolve(m.result);
      else p.reject(new Error('Codex app-server reply has neither result nor error'));
    } else throw new Error('Invalid Codex app-server message');
  }
  child.stdout.on('data', (chunk: Buffer) => {
    if (closing) return;
    buffer += decoder.write(chunk);
    try {
      let end: number;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (line.length > 16 * 1024 * 1024) throw new Error('Codex app-server message too large');
        if (line.trim()) receive(line);
      }
      if (buffer.length > 16 * 1024 * 1024) throw new Error('Codex app-server message too large');
    } catch (error) { fail(new Error(`Invalid Codex app-server output: ${messageOf(error)}`)); }
  });
  child.stderr.setEncoding('utf8').on('data', (text: string) => { stderr = (stderr + text).slice(-2000); });
  child.stdout.on('error', (error) => fail(error));
  child.stderr.on('error', (error) => fail(error));
  child.stdin.on('error', (error) => fail(error));
  child.on('error', (error) => fail(error));
  // Observe while turns are active too: a foreground/native PTY can detach before the first
  // background-list response. Creation identities keep snapshots from targeting reused PIDs.
  const observe = setInterval(() => {
    try { terminals?.track(); } catch (error) { fail(new Error(messageOf(error))); }
  }, 500);
  observe.unref?.();
  child.on('exit', (code, exitSignal) => {
    clearInterval(observe);
    if (!closing) fail(new Error(`Codex app-server exited (${exitSignal ?? code})${stderr.trim() ? `: ${stderr.trim()}` : ''}`));
    // Do not wait for `close`: a child command may still hold the dead parent's pipes open.
    try { terminals?.kill(); } catch (error) { failure ??= new Error(messageOf(error)); }
    if (OWN_GROUP) signal('SIGKILL');
  });
  running.set(close, { done, force: () => {
    close();
    try { terminals?.kill(); } catch (error) { failure ??= new Error(messageOf(error)); }
    signal('SIGKILL');
  } });
  child.on('close', (code, exitSignal) => {
    clearInterval(observe);
    running.delete(close);
    // The parent can exit while commands with redirected stdio remain in its process group.
    // They must not outlive the transport merely because no pipe still holds `close` open.
    if (OWN_GROUP) signal('SIGKILL');
    clearTimeout(terminate);
    clearTimeout(kill);
    if (!closing) failure = new Error(`Codex app-server exited (${exitSignal ?? code})${stderr.trim() ? `: ${stderr.trim()}` : ''}`);
    closing = true;
    rejectPending(failure ?? new Error('Codex app-server connection closed'));
    if (failure) rejectDone(failure);
    else resolveDone();
  });
  // Refuse to proceed if the initial app-server identity could not be established.
  try { terminals?.track(); } catch (error) { fail(new Error(messageOf(error))); }
  return {
    pid: child.pid,
    trackProcesses: (pids) => terminals?.track(pids),
    request<T>(method: string, params: Record<string, unknown>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        if (closing) return reject(failure ?? new Error('Codex app-server connection closed'));
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          // A timed-out mutating RPC has an unknown outcome. Never retry it on a live connection.
          const error = new Error(`Codex app-server ${method} timed out`);
          reject(error);
          fail(error);
        }, options.timeoutMs ?? 30_000);
        pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
        try { write({ id, method, params }); }
        catch (error) { fail(new Error(messageOf(error))); }
      });
    },
    notify: (method, params) => write({ method, params }),
    close,
    done,
  };
}
