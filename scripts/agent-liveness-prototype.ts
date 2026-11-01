// Experimental POSIX-only liveness supervisor, not used by Obeya.
// The caller starts this script with a private pipe as fd 3 and keeps its write end open.
// It passes the command after `--`. On EOF the supervisor kills the child and descendants it
// observed. Only fd 0/1/2 reach the child: it cannot accidentally keep the liveness pipe alive.
// This is a sampling experiment, not containment or a production crash-recovery mechanism.
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { AgentProcesses } from '../src/server/agent-processes';
import { createGeneration, processIdentity, type ProcessIdentity } from './agent-registry-prototype';

// Bun consumes the separator before exposing argv to the script.
const argv = process.argv.slice(2);
if (process.platform === 'win32' || !argv.length) {
  console.error('POSIX prototype: provide a private liveness pipe on fd 3 and a command after --');
  process.exit(2);
}

// Optional report-only Linux registry. The child waits at a private gate until its identity has
// been recorded. Record writes are fsynced, but the prototype is not a production crash guarantee.
const registryRoot = process.env.OBEYA_PROTO_REGISTRY;
let registry: ReturnType<typeof createGeneration> | undefined;
if (registryRoot) {
  try {
    const self = processIdentity(process.pid);
    if (!self) throw new Error('Linux supervisor identity unavailable');
    registry = createGeneration(registryRoot, self);
    console.error(`registry-generation:${registry.id}`);
  } catch (error) { console.error('registry startup:', error); process.exit(1); }
}
const env = { ...process.env };
delete env.OBEYA_PROTO_REGISTRY;
// The shell cannot execute agent code until the supervisor releases fd 3. If the supervisor dies
// first, EOF makes the shell exit; closing the descriptor before exec keeps it out of the agent.
const child = spawn('/bin/sh', ['-c', 'IFS= read -r gate <&3 || exit 125; exec 3<&-; exec "$@"', 'obeya-gate', ...argv], {
  stdio: ['inherit', 'inherit', 'inherit', 'pipe'], detached: true, env,
});
const tracker = child.pid ? new AgentProcesses(child.pid) : undefined;
let finished = false;
let failed = false;
let timer: ReturnType<typeof setInterval> | undefined;
const recorded = new Map<string, ProcessIdentity>();

function snapshot() {
  tracker?.track();
  if (!registry || !tracker) return;
  let changed = false;
  for (const observed of tracker.observed()) {
    const current = processIdentity(observed.pid);
    // The tracker's Linux birth ticks must still match; never register an arbitrary reused PID.
    if (!current || current.start !== observed.born) continue;
    const key = `${current.pid}:${current.start}`;
    if (!recorded.has(key)) { recorded.set(key, current); changed = true; }
  }
  if (changed) registry.publish([...recorded.values()]);
}

function cleanup() {
  if (finished) return;
  finished = true;
  if (timer) clearInterval(timer);
  try { snapshot(); } catch (e) { failed = true; console.error('liveness snapshot:', e); }
  try { tracker?.kill(); } catch (e) { failed = true; console.error('liveness cleanup:', e); }
  // Signal the actual child handle, not a numeric group whose leader may already have exited.
  if (child.exitCode === null && child.signalCode === null) {
    try { child.kill('SIGKILL'); } catch (e) { failed = true; console.error('agent kill:', e); }
  }
}

const pipe = createReadStream('', { fd: 3, autoClose: true });
pipe.on('data', () => {}); // The caller sends no data; EOF is the only meaningful event.
pipe.on('end', cleanup);
pipe.on('error', (e) => { failed = true; console.error('liveness pipe:', e); cleanup(); });
child.on('error', (e) => { failed = true; console.error('agent spawn:', e); cleanup(); });
child.on('exit', () => { cleanup(); pipe.destroy(); });
child.on('close', (code) => {
  cleanup(); pipe.destroy();
  try { registry?.close(); } catch (e) { failed = true; console.error('registry close:', e); }
  process.exitCode = failed ? 1 : code ?? 1;
});
try {
  if (!tracker) throw new Error('Cannot establish agent process ownership');
  snapshot();
  if (registry && ![...recorded.values()].some((p) => p.pid === child.pid)) throw new Error('Cannot record agent identity');
  const gate = child.stdio[3];
  if (!gate || !('end' in gate)) throw new Error('Cannot open launch gate');
  gate.on('error', (e) => { failed = true; console.error('launch gate:', e); cleanup(); });
  gate.end('go\n');
  timer = setInterval(() => {
    try { snapshot(); } catch (e) { failed = true; console.error('liveness snapshot:', e); cleanup(); }
  }, 100);
} catch (e) { failed = true; console.error('liveness startup:', e); cleanup(); }
