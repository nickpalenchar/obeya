// Isolated protocol spike: intentionally NOT wired into main.ts or the owner's runtime settings.
import { isAbsolute } from 'node:path';
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
const backgroundPage = z.object({ data: z.array(z.object({ itemId: z.string(), command: z.string() })), nextCursor: z.string().nullable() });
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
    spec.dirs?.length ? 'additional workspace roots' : '',
    spec.watch ? 'before/after mutation hooks' : '',
    spec.contextUpdate ? 'per-step context updates' : '',
    spec.permissionMode && spec.permissionMode !== 'default' ? `permission mode ${spec.permissionMode}` : '',
    // Also covers interpreters selected by a CLI shim's /usr/bin/env shebang.
    Object.keys(spec.env ?? {}).some((key) => key.toLowerCase() === 'path') ? 'per-session executable search path' : '',
  ].filter(Boolean);
  if (unsupported.length) throw new Error(`Codex spike does not support: ${unsupported.join(', ')}`);
  if (spec.resume && !/^codex:[A-Za-z0-9_-]+$/.test(spec.resume)) throw new Error('Codex can only resume a codex: session, not a Claude or Pi session');
}

/**
 * Native installed Codex, not a Codex model inside another harness. The injectable connection is
 * only the wire boundary for contract tests. Production routing waits for harness-aware settings,
 * session ownership, repository trust, portable skills and the full card lifecycle tests.
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
      const permissionAbort = new AbortController();
      let thread: string | undefined;
      let turn: string | undefined;
      let ready = false;
      let closing = false;
      let pumping = false;
      let settle = false;
      let imageSupport = false;
      let background: { id: string; description: string }[] = [];
      let poll: ReturnType<typeof setTimeout> | undefined;
      const emit = (event: AgentEvent) => { if (!closing) spec.onEvent(event); };
      const connection = connect(spec, { notification, request: serverRequest });
      const done = connection.done.catch((error: unknown) => {
        if (!closing) emit({ type: 'error', message: messageOf(error) });
      }).finally(() => {
        closing = true;
        permissionAbort.abort();
        clearTimeout(poll);
      });

      function fail(error: unknown) {
        if (closing) return;
        emit({ type: 'error', message: messageOf(error) });
        close();
      }
      function close() {
        if (closing) return;
        closing = true;
        permissionAbort.abort();
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
        let cursor: string | null = null;
        do {
          const page = backgroundPage.parse(await connection.request('thread/backgroundTerminals/list', { threadId: thread, cursor, limit: 100 }));
          tasks.push(...page.data.map((t) => ({ id: t.itemId, description: t.command })));
          cursor = page.nextCursor;
        } while (cursor && !closing);
        if (closing) return;
        const hadTasks = background.length > 0;
        if (JSON.stringify(tasks) !== JSON.stringify(background)) emit({ type: 'background', tasks });
        background = tasks;
        // Codex's shell terminal doesn't itself create a new turn when it exits, unlike Claude's
        // background task. Wake the coding loop to inspect its outcome rather than report success.
        if (hadTasks && !tasks.length && !queue.length) queue.push({ text: 'The background commands have ended. Inspect their results and continue your task.', images: [] });
        clearTimeout(poll);
        if (tasks.length) poll = setTimeout(() => { settle = true; void pump(); }, 1000);
      }
      async function pump() {
        if (!ready || pumping || closing) return;
        pumping = true;
        try {
          while (!closing) {
            if (settle) {
              settle = false;
              await backgrounds();
              if (closing) break;
              // A poll during a live turn is not an idle event.
              if (!turn) emit({ type: 'idle', background: background.length, more: queue.length > 0 });
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
        try {
          if (method === 'turn/started') {
            const result = turnEvent.parse(params);
            turn = result.turn.id;
          } else if (method === 'turn/completed') {
            const result = turnEvent.parse(params).turn;
            if ((turn && result.id !== turn) || completed.has(result.id)) return;
            completed.add(result.id);
            toolResults.clear();
            if (completed.size > 100) completed.delete(completed.values().next().value!);
            turn = undefined;
            if (result.status === 'failed') {
              const info = result.error?.codexErrorInfo;
              emit({ type: 'error', message: result.error?.message ?? 'Codex turn failed', ...(['usageLimitExceeded', 'rateLimitExceeded'].includes(String(info)) ? { limit: {} } : {}) });
            }
            settle = true;
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
          // Error notifications with willRetry belong to Codex's retry loop. Only turn/completed
          // establishes an idle/error boundary; individual items and transient errors never do.
        } catch (error) { fail(error); }
      }
      async function serverRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
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
              return { contentItems: [{ type: 'inputText', text }], success: true };
            } catch (error) { return { contentItems: [{ type: 'inputText', text: messageOf(error) }], success: false }; }
          })();
          toolResults.set(key, result);
          return result;
        }
        if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
          const name = method.includes('commandExecution') ? 'Bash' : 'Edit';
          const reason = typeof params.reason === 'string' ? params.reason : undefined;
          // Codex's availableDecisions may restrict a proposed amendment to a choice this spike
          // doesn't understand. Never approve amendments, broad grants, or session-wide authority.
          const decisions = params.availableDecisions;
          const canAccept = !Array.isArray(decisions) || decisions.includes('accept');
          const answer = spec.askOwner && canAccept ? await spec.askOwner({ name, input: params, reason }, permissionAbort.signal) : { allow: false, message: 'No owner approval available' };
          if (!closing && answer.allow && params.turnId === turn) return { decision: 'accept' };
          emit({ type: 'denied', name, input: params, by: 'obeya', reason: answer.allow ? 'Turn ended before permission was granted' : answer.message });
          return { decision: 'decline' };
        }
        if (method === 'item/permissions/requestApproval') {
          emit({ type: 'denied', name: 'permissions', input: params, by: 'obeya', reason: 'Extended permission profiles are not supported by the Codex spike' });
          return { permissions: {}, scope: 'turn' };
        }
        // Native requestUserInput isn't Obeya's shared question workflow. Agents must use ask.
        throw new CodexRpcError(-32601, `Unsupported Codex request: ${method}; use the Obeya tools`);
      }
      void (async () => {
        try {
          await connection.request('initialize', { clientInfo: { name: 'obeya', title: 'Obeya', version: '0.1.0' }, capabilities: { experimentalApi: true } });
          if (closing) return;
          connection.notify('initialized', {});
          const models: z.infer<typeof modelPage>['data'] = [];
          let cursor: string | null = null;
          do {
            const page = modelPage.parse(await connection.request('model/list', { cursor, limit: 100 }));
            models.push(...page.data);
            cursor = page.nextCursor;
          } while (cursor && !closing);
          if (closing) return;
          const model = spec.model ? models.find((m) => m.model === spec.model) : models.find((m) => m.isDefault);
          if (!model) throw new Error(`Codex model unavailable: ${spec.model ?? '(account default)'}`);
          if (spec.effort && !model.supportedReasoningEfforts.some((e) => e.reasoningEffort === spec.effort)) throw new Error(`Codex model ${model.model} does not support effort ${spec.effort}`);
          imageSupport = model.inputModalities.includes('image');
          const params = { cwd: spec.cwd, model: model.model, developerInstructions: spec.system, approvalPolicy: 'on-request', sandbox: 'workspace-write' };
          const result = threadResult.parse(await connection.request(spec.resume ? 'thread/resume' : 'thread/start', spec.resume ? { ...params, threadId: spec.resume.slice('codex:'.length) } : { ...params, dynamicTools }));
          if (closing) return;
          if (result.model !== model.model) throw new Error(`Codex substituted model ${result.model} for ${model.model}`);
          thread = result.thread.id;
          if (spec.resume && `codex:${thread}` !== spec.resume) throw new Error('Codex resumed an unexpected thread');
          emit({ type: 'session', id: `codex:${thread}` });
          ready = true;
          void pump();
        } catch (error) { fail(error); }
      })();
      if (firstMessage !== undefined) send(firstMessage, images);
      return { send, close, done };
    },
  };
}

export const codexRuntime = createCodexRuntime();
