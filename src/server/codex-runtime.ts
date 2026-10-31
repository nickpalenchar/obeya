// Native installed Codex app-server adapter. Worker routing and portability live separately.
import { isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import type { CodexModel } from '../core/types';
import { z } from 'zod';
import { messageOf } from '../core/text';
import { codexConnection, CodexRpcError, type CodexConnection, type CodexHandlers } from './codex-rpc';
import { cleanEnv, type AgentEvent, type AgentRuntime, type AgentSpec } from './runtime';

// Codex reserves mcp__ names for actual MCP servers. Keep its wire name separate from the
// canonical identity consumed by Obeya's existing orchestration.
const wirePrefix = 'obeya_';
const threadResult = z.object({ thread: z.object({ id: z.string().min(1) }), model: z.string() });
const turnResult = z.object({ turn: z.object({ id: z.string().min(1) }) });
const modelPage = z.object({
  data: z.array(z.object({ model: z.string(), isDefault: z.boolean(), supportedReasoningEfforts: z.array(z.object({ reasoningEffort: z.string() })), inputModalities: z.array(z.string()) })),
  nextCursor: z.string().nullable(),
});
const backgroundPage = z.object({ data: z.array(z.object({ itemId: z.string(), command: z.string(), osPid: z.number().int().positive().nullable().optional() })), nextCursor: z.string().nullable() });
const turnEvent = z.object({ turn: z.object({ id: z.string(), status: z.string(), error: z.object({ message: z.string(), codexErrorInfo: z.unknown() }).nullable().optional() }) });
const toolCall = z.object({ threadId: z.string(), turnId: z.string(), callId: z.string(), namespace: z.string().nullable(), tool: z.string(), arguments: z.unknown() });
const jsonObject = z.record(z.string(), z.unknown());

type Connect = (spec: AgentSpec, handlers: CodexHandlers) => CodexConnection;
const connectInstalled: Connect = (spec, handlers) => {
  // Resolve before applying session environment additions. An npm .cmd shim is not a native
  // executable on Windows; do not work around that by introducing a shell into the transport.
  const executable = Bun.which(process.env.OBEYA_CODEX ?? 'codex', { PATH: process.env.PATH ?? '' });
  if (!executable || !isAbsolute(executable) || /\.(cmd|bat|ps1)$/i.test(executable)) throw new Error('Installed Codex executable unavailable; set OBEYA_CODEX to its native executable path');
  return codexConnection({
    command: executable,
    args: ['app-server', '--listen', 'stdio://'],
    cwd: spec.cwd,
    env: { ...cleanEnv(), ...spec.env },
  }, handlers);
};

/** Refuse gaps in the spike rather than quietly dropping a safety or orchestration contract. */
function supported(spec: AgentSpec) {
  const unsupported = [
    !isAbsolute(spec.cwd) || spec.cwd.startsWith('ssh://') ? 'non-local working directory' : '',
    spec.readOnly ? 'read-only tool restrictions' : '',
    spec.untrusted ? 'untrusted repository configuration' : '',
    spec.plugins?.length ? 'Claude plugins' : '',
    spec.dirs?.some((d) => !isAbsolute(d)) ? 'non-local additional workspace roots' : '',
    spec.watch ? 'before/after mutation hooks' : '',
    spec.permissionMode && spec.permissionMode !== 'default' ? `permission mode ${spec.permissionMode}` : '',
    // Also covers interpreters selected by a CLI shim's /usr/bin/env shebang.
    Object.keys(spec.env ?? {}).some((key) => key.toLowerCase() === 'path') ? 'per-session executable search path' : '',
  ].filter(Boolean);
  if (unsupported.length) throw new Error(`Codex does not support: ${unsupported.join(', ')}`);
  if (spec.resume && !/^codex:[A-Za-z0-9_-]+$/.test(spec.resume)) throw new Error('Codex can only resume a codex: session, not a Claude or Pi session');
}

/**
 * Native installed Codex, not a Codex model inside another harness. The injectable connection is
 * only the wire boundary for contract tests. Harness routing pins the setting to each card.
 */
export function createCodexRuntime(connect: Connect = connectInstalled): AgentRuntime {
  return {
    start(spec, firstMessage, images) {
      supported(spec);
      const tools = new Map(spec.tools.map((t) => [wirePrefix + t.name, { tool: t, schema: z.object(t.schema).strict() }]));
      if (tools.size !== spec.tools.length) throw new Error('Duplicate Obeya tool name');
      const dynamicTools = [...tools].map(([name, { tool, schema }]) => ({ type: 'function', name, description: tool.description, inputSchema: z.toJSONSchema(schema) }));
      const queue: { text: string; images: string[] }[] = [];
      const completed = new Set<string>();
      const toolResults = new Map<string, Promise<unknown>>();
      const permissions = new Map<string | number | symbol, AbortController>();
      const cancelPermissions = (obsolete = false) => {
        for (const controller of permissions.values()) controller.abort(obsolete ? 'permission-obsolete' : undefined);
        permissions.clear();
      };
      let thread: string | undefined;
      let turn: string | undefined;
      let ready = false;
      let closing = false;
      let pumping = false;
      let settle = false;
      let idlePending = false;
      let imageSupport = false;
      let background: { id: string; description: string }[] = [];
      let poll: ReturnType<typeof setTimeout> | undefined;
      const emit = (event: AgentEvent) => { if (!closing) spec.onEvent(event); };
      const connection = connect(spec, { notification, request: serverRequest });
      const done = connection.done.catch((error: unknown) => {
        if (!closing) { emit({ type: 'error', message: messageOf(error) }); emit({ type: 'idle' }); }
      }).finally(() => {
        closing = true;
        cancelPermissions();
        clearTimeout(poll);
      });

      function fail(error: unknown) {
        if (closing) return;
        emit({ type: 'error', message: messageOf(error) });
        emit({ type: 'idle' });
        close();
      }
      function close() {
        if (closing) return;
        closing = true;
        cancelPermissions();
        clearTimeout(poll);
        // Try the semantic cleanup first, but do not wait a full RPC timeout to begin process
        // shutdown. EOF plus the transport's escalation bounds a stuck app-server as well.
        const deadline = setTimeout(() => connection.close(), 1000);
        void (async () => {
          try {
            try {
              if (thread && turn) await connection.request('turn/interrupt', { threadId: thread, turnId: turn });
            } catch { /* a turn can end between close() and interrupt */ }
            try {
              if (thread) await connection.request('thread/backgroundTerminals/clean', { threadId: thread });
            } catch { /* still close the transport if cleanup is unsupported or fails */ }
          } finally { clearTimeout(deadline); connection.close(); }
        })();
      }
      function send(text: string, files: string[] = []) {
        if (closing) return;
        if (files.some((f) => !isAbsolute(f))) throw new Error('Codex images must be absolute local file paths');
        queue.push({ text, images: [...files] });
        void pump();
      }
      async function backgrounds() {
        const tasks: typeof background = [];
        const pids: number[] = [];
        let cursor: string | null = null;
        do {
          const page = backgroundPage.parse(await connection.request('thread/backgroundTerminals/list', { threadId: thread, cursor, limit: 100 }));
          tasks.push(...page.data.map((t) => ({ id: t.itemId, description: t.command })));
          pids.push(...page.data.flatMap((t) => t.osPid ? [t.osPid] : []));
          cursor = page.nextCursor;
        } while (cursor && !closing);
        if (closing) return;
        connection.trackProcesses?.(pids);
        const ended = background.filter((before) => !tasks.some((now) => now.id === before.id));
        const changed = JSON.stringify(tasks) !== JSON.stringify(background);
        if (changed) emit({ type: 'background', tasks });
        background = tasks;
        // Codex's shell terminal doesn't itself create a new turn when it exits, unlike Claude's
        // background task. Wake the coding loop to inspect its outcome rather than report success.
        if (ended.length) queue.push({ text: `Background commands have ended: ${ended.map((t) => t.description).join('; ')}. Inspect their results and continue your task.`, images: [] });
        clearTimeout(poll);
        if (tasks.length) poll = setTimeout(() => { settle = true; void pump(); }, 1000);
        return changed;
      }
      async function pump() {
        if (!ready || pumping || closing) return;
        pumping = true;
        try {
          while (!closing) {
            if (settle) {
              settle = false;
              const changed = await backgrounds();
              if (closing) break;
              // Unchanged polls must not reset the worker's background timeout.
              if (!turn && (changed || idlePending)) emit({ type: 'idle', background: background.length, more: queue.length > 0 });
              idlePending = false;
            }
            if (closing) break;
            const next = queue[0];
            if (!next) break;
            if (next.images.length && !imageSupport) throw new Error('Selected Codex model does not support images');
            const input = [{ type: 'text', text: next.text, text_elements: [] }, ...next.images.map((path) => ({ type: 'localImage', path }))];
            if (turn) {
              const expected = turn;
              try {
                const result = z.object({ turnId: z.string() }).parse(await connection.request('turn/steer', { threadId: thread, expectedTurnId: expected, input }));
                if (result.turnId !== expected) throw new Error('Codex accepted input for an unexpected turn');
              } catch (error) {
                // Only a definite server rejection is retryable. A timeout or transport failure
                // may have accepted input; replaying it can duplicate instructions or actions.
                if (error instanceof CodexRpcError && completed.has(expected)) continue;
                throw error;
              }
            } else {
              const result = turnResult.parse(await connection.request('turn/start', { threadId: thread, input, ...(spec.effort ? { effort: spec.effort } : {}) }));
              if (!completed.has(result.turn.id)) turn = result.turn.id;
            }
            queue.shift();
          }
        } catch (error) { fail(error); }
        finally { pumping = false; }
      }
      function notification(method: string, params: Record<string, unknown>) {
        if (closing || params.threadId !== thread || !thread) return;
        if (method === 'serverRequest/resolved') {
          const id = params.requestId;
          if (typeof id === 'string' || typeof id === 'number') {
            permissions.get(id)?.abort('permission-obsolete');
            permissions.delete(id);
          }
          return;
        }
        try {
          if (method === 'turn/started') {
            const result = turnEvent.parse(params);
            turn = result.turn.id;
          } else if (method === 'turn/completed') {
            const result = turnEvent.parse(params).turn;
            if ((turn && result.id !== turn) || completed.has(result.id)) return;
            completed.add(result.id);
            cancelPermissions(true);
            toolResults.clear();
            if (completed.size > 100) completed.delete(completed.values().next().value!);
            turn = undefined;
            if (result.status === 'failed') {
              const info = result.error?.codexErrorInfo;
              emit({ type: 'error', message: result.error?.message ?? 'Codex turn failed', ...(['usageLimitExceeded', 'rateLimitExceeded'].includes(String(info)) ? { limit: {} } : {}) });
            }
            settle = true;
            idlePending = true;
            void pump();
          } else if (method === 'item/agentMessage/delta') {
            if (params.turnId === turn) emit({ type: 'text', text: z.string().parse(params.delta) });
          } else if (method === 'item/started') {
            if (params.turnId !== turn) return;
            const item = jsonObject.parse(params.item);
            if (item.type === 'commandExecution') emit({ type: 'tool', name: 'Bash', input: { command: item.command, cwd: item.cwd } });
            else if (item.type === 'fileChange') emit({ type: 'tool', name: 'Edit', input: { changes: item.changes } });
            // Obeya tools are emitted at dispatch, not twice (here and item/tool/call).
          }
          if (method === 'item/completed' && params.turnId === turn) {
            const item = jsonObject.parse(params.item);
            if (item.type === 'commandExecution' || item.type === 'fileChange') {
              const update = spec.contextUpdate?.();
              if (update) send(update);
            }
          }
          // Error notifications with willRetry belong to Codex's retry loop. Only turn/completed
          // establishes an idle/error boundary; individual items and transient errors never do.
        } catch (error) { fail(error); }
      }
      async function serverRequest(method: string, params: Record<string, unknown>, requestId?: string | number): Promise<unknown> {
        if (closing || !thread || params.threadId !== thread || !turn || params.turnId !== turn) throw new CodexRpcError(-32602, 'Request does not belong to the active Obeya thread and turn');
        if (method === 'item/tool/call') {
          const call = toolCall.parse(params);
          const key = `${call.turnId}:${call.callId}`;
          const existing = toolResults.get(key);
          if (existing) return existing;
          const result = (async () => {
            const entry = call.namespace === null ? tools.get(call.tool) : undefined;
            if (!entry) return { contentItems: [{ type: 'inputText', text: 'Unknown Obeya tool' }], success: false };
            try {
              const args = entry.schema.parse(call.arguments);
              emit({ type: 'tool', name: `mcp__obeya__${entry.tool.name}`, input: args });
              const text = await entry.tool.run(args);
              const update = spec.contextUpdate?.();
              return { contentItems: [{ type: 'inputText', text: update ? `${text}\n\n${update}` : text }], success: true };
            } catch (error) { return { contentItems: [{ type: 'inputText', text: messageOf(error) }], success: false }; }
          })();
          toolResults.set(key, result);
          return result;
        }
        if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
          const name = method.includes('commandExecution') ? 'Bash' : 'Edit';
          const reason = typeof params.reason === 'string' ? params.reason : undefined;
          // Persist the action and its authority, not ephemeral RPC identities. A restarted
          // thread reissues the same approval with new turn/item ids; a one-use owner grant
          // must still match, but a changed command or permission scope must not.
          const { threadId: _, turnId: __, itemId: ___, reason: ____, availableDecisions: _____, startedAtMs: ______, approvalId: _______, ...input } = params;
          // Codex's availableDecisions may restrict a proposed amendment to a choice this spike
          // doesn't understand. Never approve amendments, broad grants, or session-wide authority.
          const decisions = params.availableDecisions;
          const canAccept = params.grantRoot == null && (!Array.isArray(decisions) || decisions.includes('accept'));
          const key = requestId ?? Symbol();
          const controller = new AbortController();
          permissions.set(key, controller);
          try {
            const answer = spec.askOwner && canAccept ? await spec.askOwner({ name, input, reason }, controller.signal) : { allow: false, message: 'No one-action owner approval available' };
            if (closing || controller.signal.aborted || params.turnId !== turn) return { decision: 'decline' };
            if (answer.allow) return { decision: 'accept' };
            emit({ type: 'denied', name, input, by: spec.askOwner && canAccept ? 'owner' : 'mode', reason: answer.message });
            // Codex's decline, unlike Claude's tool result, carries no explanation to the model.
            if (spec.askOwner && canAccept && answer.message) send(answer.message);
            return { decision: 'decline' };
          } finally { permissions.delete(key); }
        }
        if (method === 'item/permissions/requestApproval') {
          emit({ type: 'denied', name: 'permissions', input: params, by: 'mode', reason: 'Extended permission profiles are not supported by the Codex worker' });
          return { permissions: {}, scope: 'turn' };
        }
        // Native requestUserInput isn't Obeya's shared question workflow. Agents must use ask.
        throw new CodexRpcError(-32601, `Unsupported Codex request: ${method}; use the Obeya tools`);
      }
      void (async () => {
        try {
          const models = await discover(connection, () => closing);
          if (closing) return;
          const model = spec.model ? models.find((m) => m.model === spec.model) : models.find((m) => m.isDefault);
          if (!model) throw new Error(`Codex model unavailable: ${spec.model ?? '(account default)'}`);
          if (spec.effort && !model.supportedReasoningEfforts.some((e) => e.reasoningEffort === spec.effort)) throw new Error(`Codex model ${model.model} does not support effort ${spec.effort}`);
          imageSupport = model.inputModalities.includes('image');
          const config = {
            ...(spec.dirs?.length ? { 'sandbox_workspace_write.writable_roots': spec.dirs } : {}),
            ...(connection.pid ? { 'shell_environment_policy.set': { OBEYA_AGENT_PID: String(connection.pid) } } : {}),
          };
          const params = { cwd: spec.cwd, model: model.model, developerInstructions: spec.system, approvalPolicy: 'on-request', sandbox: 'workspace-write', config };
          const result = threadResult.parse(await connection.request(spec.resume ? 'thread/resume' : 'thread/start', spec.resume ? { ...params, threadId: spec.resume.slice('codex:'.length) } : { ...params, dynamicTools }));
          if (closing) return;
          if (result.model !== model.model) throw new Error(`Codex substituted model ${result.model} for ${model.model}`);
          thread = result.thread.id;
          if (spec.resume && `codex:${thread}` !== spec.resume) throw new Error('Codex resumed an unexpected thread');
          emit({ type: 'session', id: `codex:${thread}`, ...(spec.setting ? { setting: { ...spec.setting, codex: { model: model.model, effort: spec.effort ?? 'high' } } } : {}) });
          ready = true;
          void pump();
        } catch (error) { fail(error); }
      })();
      if (firstMessage !== undefined) send(firstMessage, images);
      return { send, close, done };
    },
  };
}

async function discover(connection: CodexConnection, closing: () => boolean): Promise<CodexModel[]> {
  await connection.request('initialize', { clientInfo: { name: 'obeya', title: 'Obeya', version: '0.1.0' }, capabilities: { experimentalApi: true } });
  if (closing()) return [];
  connection.notify('initialized', {});
  const models: CodexModel[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = modelPage.parse(await connection.request('model/list', { cursor, limit: 100 }));
    models.push(...page.data);
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error('Codex returned a repeated model-list cursor');
    if (cursor) seen.add(cursor);
  } while (cursor && !closing());
  return models;
}

/** Account catalog only: does not create a thread or spend a model turn. */
export async function codexModels(): Promise<CodexModel[]> {
  const connection = connectInstalled({ cwd: homedir(), system: '', tools: [], onEvent() {} }, {
    notification() {}, request: async () => { throw new CodexRpcError(-32601, 'No active worker'); },
  });
  try { return await discover(connection, () => false); }
  finally { connection.close(); await connection.done.catch(() => {}); }
}

export const codexRuntime = createCodexRuntime();
