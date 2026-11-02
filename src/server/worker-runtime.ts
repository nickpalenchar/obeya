// Roles belong to Obeya; a harness supplies the coding loop. Local workers roll out first.
import { spawnSync } from 'node:child_process';
import { GIT } from './workspaces';
import { messageOf } from '../core/text';
import { OBEYA_PLUGIN } from './demo';
import { createCodexRuntime } from './codex-runtime';
import { bundledSkills } from './skills';
import type { AgentRuntime, AgentSpec } from './runtime';

/** Only Obeya's bundled plugin is portable here, by explicit file-based skill instructions. */
function portable(spec: AgentSpec): AgentSpec {
  if (spec.permissionMode && !['auto', 'default'].includes(spec.permissionMode)) throw new Error(`Codex cannot apply Claude permission mode ${spec.permissionMode}`);
  if (spec.plugins?.some((p) => p !== OBEYA_PLUGIN)) throw new Error('Codex supports only the bundled Obeya skills');
  if (spec.cwd.startsWith('ssh://')) throw new Error('Codex workers currently require a local Git workspace');
  if (spec.watch) throw new Error('Codex workers do not yet support folders without Git');
  const git = spawnSync(GIT, ['-C', spec.cwd, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8', windowsHide: true });
  if (git.status !== 0 || git.stdout.trim() !== 'true') throw new Error('Codex workers currently require a local Git workspace');
  const skills = bundledSkills().map((s) => `- ${s.name}: ${s.description}\n  ${s.file}`);
  const { plugins: _, permissionMode: __, ...rest } = spec;
  return { ...rest, system: `${spec.system}\n\nObeya skills are available as files, not Claude slash commands. Read the matching SKILL.md before using a skill, resolving its relative paths against its directory.\n${skills.join('\n')}\nUse the Obeya ask tool for owner questions, not a native terminal dialog.` };
}

export function workerHarnessRuntime(claude: AgentRuntime, codex: AgentRuntime = createCodexRuntime()): AgentRuntime {
  return {
    start(spec, firstMessage, images) {
      try {
        const selected = spec.setting?.harness === 'codex';
        const ownsCodex = spec.resume?.startsWith('codex:');
        if (spec.resume && !!ownsCodex !== selected) throw new Error('Saved session and worker harness disagree; refusing cross-harness resume');
        if (!selected) return claude.start(spec, firstMessage, images);
        if (spec.role !== 'worker') throw new Error('Codex is currently available only for card workers');
        return codex.start(portable(spec), firstMessage, images);
      } catch (error) {
        // Orchestration attaches the returned session before observing startup errors, just as it
        // does for SDK login/configuration failures. A failed startup must not leave a busy ghost:
        // the session ended with its error, so the card goes to the owner rather than staying at work.
        let closed = false;
        const done = Promise.resolve().then(() => {
          if (closed) return;
          spec.onEvent({ type: 'error', message: messageOf(error), ended: true });
          spec.onEvent({ type: 'idle' });
        });
        return { send() {}, close() { closed = true; }, done };
      }
    },
  };
}
