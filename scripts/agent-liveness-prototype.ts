// Experimental POSIX-only liveness supervisor, not used by Obeya.
// The caller starts this script with a private pipe as fd 3 and keeps its write end open.
// It passes the command after `--`. On EOF the supervisor kills the child and descendants it
// observed. Only fd 0/1/2 reach the child: it cannot accidentally keep the liveness pipe alive.
// This is a sampling experiment, not containment or a production crash-recovery mechanism.
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { AgentProcesses } from '../src/server/agent-processes';

// Bun consumes the separator before exposing argv to the script.
const argv = process.argv.slice(2);
if (process.platform === 'win32' || !argv.length) {
  console.error('POSIX prototype: provide a private liveness pipe on fd 3 and a command after --');
  process.exit(2);
}

const child = spawn(argv[0]!, argv.slice(1), { stdio: ['inherit', 'inherit', 'inherit'], detached: true });
const tracker = child.pid ? new AgentProcesses(child.pid) : undefined;
let finished = false;
let failed = false;
let timer: ReturnType<typeof setInterval> | undefined;

function cleanup() {
  if (finished) return;
  finished = true;
  if (timer) clearInterval(timer);
  try { tracker?.track(); } catch (e) { failed = true; console.error('liveness snapshot:', e); }
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
child.on('close', (code) => { cleanup(); pipe.destroy(); process.exitCode = failed ? 1 : code ?? 1; });
try {
  if (!tracker) throw new Error('Cannot establish agent process ownership');
  tracker.track();
  timer = setInterval(() => {
    try { tracker.track(); } catch (e) { failed = true; console.error('liveness snapshot:', e); cleanup(); }
  }, 100);
} catch (e) { failed = true; console.error('liveness startup:', e); cleanup(); }
