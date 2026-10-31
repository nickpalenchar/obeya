import { expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexConnection } from './codex-rpc';

const handlers = { notification() {}, request: async () => ({}) };
const beat = (file: string) => { try { return Number(readFileSync(file, 'utf8')); } catch { return 0; } };
async function until(check: () => boolean) {
  const end = Date.now() + 3000;
  while (!check()) { if (Date.now() > end) throw new Error('Process cleanup probe timed out'); await Bun.sleep(10); }
}
function kill(pid: number | undefined) { if (pid) try { process.kill(pid, 'SIGKILL'); } catch {} }

test.skipIf(process.platform === 'win32')('app-server death kills its separately grouped PTY, not an unrelated PID', async () => {
  const root = mkdtempSync(join(tmpdir(), 'obeya-pty-test-'));
  const file = join(root, 'heartbeat');
  const childCode = `let n=0;const fs=await import('node:fs');setInterval(()=>fs.writeFileSync(${JSON.stringify(file)},String(++n)),25);`;
  const code = `import {spawn} from 'node:child_process'; import {createInterface} from 'node:readline';
const child=spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{detached:true,stdio:'ignore'});
createInterface({input:process.stdin}).on('line',line=>process.stdout.write(JSON.stringify({id:JSON.parse(line).id,result:child.pid})+'\\n'));
setInterval(()=>{},1000);`;
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  const c = codexConnection({ command: process.execPath, args: ['-e', code], cwd: root, env: process.env }, handlers);
  let pid: number | undefined;
  try {
    pid = await c.request<number>('spawn', {});
    await until(() => beat(file) > 2);
    c.trackProcesses!([pid, process.pid, unrelated.pid!]);
    process.kill(c.pid!, 'SIGKILL');
    await expect(c.done).rejects.toThrow('exited');
    await Bun.sleep(100);
    const stopped = beat(file);
    await Bun.sleep(150);
    expect(beat(file)).toBe(stopped);
    expect(process.kill(unrelated.pid!, 0)).toBe(true);
  } finally {
    c.close(); await c.done.catch(() => {});
    kill(pid); kill(unrelated.pid);
    rmSync(root, { recursive: true, force: true });
  }
});

test('shutdown awaits escalation before exiting, including an EOF/TERM-ignoring subprocess', async () => {
  const root = mkdtempSync(join(tmpdir(), 'obeya-exit-test-'));
  const file = join(root, 'heartbeat');
  const code = `import {writeFileSync} from 'node:fs';let n=0;process.stdin.resume();process.stdin.on('end',()=>{});process.on('SIGTERM',()=>{});setInterval(()=>writeFileSync(${JSON.stringify(file)},String(++n)),25);`;
  const driver = `import {codexConnection,endCodexHere} from ${JSON.stringify(join(import.meta.dir, 'codex-rpc.ts'))};
const c=codexConnection({command:process.execPath,args:['-e',${JSON.stringify(code)}],cwd:${JSON.stringify(root)},env:process.env},{notification(){},request:async()=>({})});
console.log(c.pid);await Bun.sleep(150);await endCodexHere();process.exit(0);`;
  const p = Bun.spawn([process.execPath, '-e', driver], { stdout: 'pipe', stderr: 'pipe' });
  let pid: number | undefined;
  try {
    const stdout = new Response(p.stdout).text();
    expect(await p.exited).toBe(0);
    pid = Number((await stdout).trim());
    expect(beat(file)).toBeGreaterThan(0);
    const stopped = beat(file);
    await Bun.sleep(100);
    expect(beat(file)).toBe(stopped);
  } finally { p.kill(); kill(pid); rmSync(root, { recursive: true, force: true }); }
}, 10_000);
