import { expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Writable } from 'node:stream';

async function until(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) { if (Date.now() > deadline) throw new Error('prototype timed out'); await Bun.sleep(20); }
}
function numberAt(path: string) { try { return Number(readFileSync(path, 'utf8')); } catch { return 0; } }
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
function kill(pid: number) { if (pid > 1) try { process.kill(pid, 'SIGKILL'); } catch {} }

test.skipIf(process.platform === 'win32')('liveness EOF stops an observed detached descendant without touching a canary', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'obeya-liveness-prototype-'));
  const pidFile = join(dir, 'pid');
  const beatFile = join(dir, 'beat');
  const worker = `import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';
const c=spawn(process.execPath,['-e',${JSON.stringify(`import {writeFileSync} from 'node:fs';let n=0;setInterval(()=>writeFileSync(${JSON.stringify(beatFile)},String(++n)),25);`)}],{detached:true,stdio:'ignore'});
writeFileSync(${JSON.stringify(pidFile)},String(c.pid));setInterval(()=>{},1000);`;
  const canary = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  const supervisor = spawn(process.execPath, [join(import.meta.dir, 'agent-liveness-prototype.ts'), '--', process.execPath, '-e', worker], { stdio: ['ignore', 'ignore', 'pipe', 'pipe'] });
  let stderr = '';
  supervisor.stderr!.on('data', (chunk) => stderr += chunk);
  let pid = 0;
  try {
    await until(() => { pid = numberAt(pidFile); return pid > 1 && numberAt(beatFile) > 2; });
    await Bun.sleep(250); // let the supervisor observe the separately grouped child
    expect(alive(pid)).toBe(true);
    const exited = new Promise<void>((resolve) => supervisor.once('close', () => resolve()));
    (supervisor.stdio[3] as Writable).end();
    await exited;
    await until(() => !alive(pid));
    expect(alive(canary.pid!)).toBe(true);
    expect(stderr).toBe('');
  } finally {
    supervisor.kill('SIGKILL'); kill(pid); kill(canary.pid ?? 0);
    rmSync(dir, { recursive: true, force: true });
  }
}, 10_000);
