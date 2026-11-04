// Native PTYs can start a new process group: killing the app-server's group is not sufficient.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';

export interface ProcessInfo { pid: number; parent: number; group: number; born: string }

const windowsSnapshotCommand = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate | ConvertTo-Json -Compress';
const powershell = ['-NoProfile', '-NonInteractive', '-Command', windowsSnapshotCommand];

type Run = { status: number | null; stdout: string; error?: NodeJS.ErrnoException };

/** Like spawnSync, without holding the event loop while the command runs. */
function run(command: string, args: string[], timeout: number): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    let stdout = '';
    let error: NodeJS.ErrnoException | undefined;
    child.stdout.setEncoding('utf8').on('data', (text: string) => { stdout += text; });
    const timer = setTimeout(() => { error = Object.assign(new Error(`${command} timed out`), { code: 'ETIMEDOUT' }); child.kill('SIGKILL'); }, timeout);
    child.on('error', (e) => { error ??= e; });
    child.on('close', (status) => { clearTimeout(timer); resolve({ status: error ? null : status, stdout, ...(error ? { error } : {}) }); });
  });
}

/** A cold PowerShell/CIM launch can exceed the normal snapshot budget on Windows. */
export class WindowsProcessSnapshot {
  private first = true;
  constructor(
    private runSync: (timeout: number) => Run = (timeout) => spawnSync('powershell.exe', powershell, { encoding: 'utf8', windowsHide: true, timeout }),
    private runAsync: (timeout: number) => Promise<Run> = (timeout) => run('powershell.exe', powershell, timeout),
  ) {}

  private budget() { return this.first ? 15_000 : 3_000; }
  // A later snapshot can also be cold after PowerShell's startup cache is evicted.
  private retry(r: Run) { return !this.first && r.error?.code === 'ETIMEDOUT'; }

  read(): ProcessInfo[] {
    const r = this.runSync(this.budget());
    return this.parse(this.retry(r) ? this.runSync(15_000) : r);
  }

  async readAsync(): Promise<ProcessInfo[]> {
    const r = await this.runAsync(this.budget());
    return this.parse(this.retry(r) ? await this.runAsync(15_000) : r);
  }

  private parse(result: Run): ProcessInfo[] {
    if (result.status !== 0) throw new Error('Cannot inspect agent process ownership');
    const rows: unknown = JSON.parse(result.stdout);
    this.first = false;
    return (Array.isArray(rows) ? rows : [rows]).flatMap((row) => {
      if (!row || typeof row !== 'object') return [];
      const p = row as Record<string, unknown>;
      return typeof p.ProcessId === 'number' && typeof p.ParentProcessId === 'number' && typeof p.CreationDate === 'string'
        ? [{ pid: p.ProcessId, parent: p.ParentProcessId, group: p.ProcessId, born: p.CreationDate }] : [];
    });
  }
}

const windowsSnapshot = new WindowsProcessSnapshot();

/** /proc/<pid>/stat's command is parenthesized and can itself contain spaces and parentheses. */
export function linuxProcessStat(stat: string): ProcessInfo | undefined {
  const open = stat.indexOf(' (');
  const end = stat.lastIndexOf(')');
  if (open < 1 || end <= open) return;
  const pid = Number(stat.slice(0, open));
  // Fields after comm start with state (3); ppid is 4, pgrp 5, starttime 22.
  const fields = stat.slice(end + 1).trim().split(/\s+/);
  const parent = Number(fields[1]), group = Number(fields[2]), born = fields[19];
  if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(parent) || parent < 0 || !Number.isSafeInteger(group) || group <= 0 || !born || !/^\d+$/.test(born)) return;
  return { pid, parent, group, born };
}

function linuxProcess(name: string, stat: string): ProcessInfo[] {
  const p = linuxProcessStat(stat);
  return p && p.pid === Number(name) ? [p] : [];
}

function linuxUnreadable(name: string, error: unknown, required: Set<number>): ProcessInfo[] {
  const code = (error as NodeJS.ErrnoException).code ?? '';
  if (['ENOENT', 'ESRCH'].includes(code)) return []; // exited during the snapshot
  if (['EACCES', 'EPERM'].includes(code) && !required.has(Number(name))) return []; // unrelated or unobservable
  throw error; // never silently lose a process already known to belong to the agent
}

// Some procfs configurations omit inaccessible processes from directory listings.
const linuxNames = (listed: string[], required: Set<number>) => new Set([...listed, ...[...required].map(String)]);

const psArgs = ['-axo', 'pid=,ppid=,pgid=,lstart='];

function psRows(r: Run): ProcessInfo[] {
  if (r.status !== 0) throw new Error('Cannot inspect agent process ownership');
  return r.stdout.split('\n').flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    return m ? [{ pid: Number(m[1]), parent: Number(m[2]), group: Number(m[3]), born: m[4]! }] : [];
  });
}

/** The process table, blocking: only for the sweep at start, before the server serves anyone. */
export function processes(required = new Set<number>()): ProcessInfo[] {
  if (process.platform === 'linux') {
    return [...linuxNames(readdirSync('/proc'), required)].flatMap((name) => {
      if (!/^\d+$/.test(name)) return [];
      try { return linuxProcess(name, readFileSync(`/proc/${name}/stat`, 'utf8')); }
      catch (error) { return linuxUnreadable(name, error, required); }
    });
  }
  if (process.platform === 'win32') return windowsSnapshot.read();
  return psRows(spawnSync('ps', psArgs, { encoding: 'utf8', timeout: 3000 }));
}

/** The process table without holding the event loop: a busy machine's `ps` can take seconds. */
export async function processesAsync(required = new Set<number>()): Promise<ProcessInfo[]> {
  if (process.platform === 'linux') {
    const names = [...linuxNames(await readdir('/proc'), required)].filter((name) => /^\d+$/.test(name));
    const rows = await Promise.all(names.map(async (name) => {
      try { return linuxProcess(name, await readFile(`/proc/${name}/stat`, 'utf8')); }
      catch (error) { return linuxUnreadable(name, error, required); }
    }));
    return rows.flat();
  }
  if (process.platform === 'win32') return windowsSnapshot.readAsync();
  return psRows(await run('ps', psArgs, 3000));
}

/**
 * Only register descendants while ownership is provable; remember their creation time against PID reuse.
 * Snapshots are taken without blocking the event loop, so every operation waits for the ones before
 * it: a kill always sees what an earlier track registered.
 */
export class AgentProcesses {
  private owned = new Map<number, ProcessInfo>();
  private rootBorn?: string;
  private snapshotError?: unknown;
  private queue: Promise<unknown>;
  constructor(private parent: number, private snapshot: (required: Set<number>) => ProcessInfo[] | Promise<ProcessInfo[]> = processesAsync) {
    this.queue = (async () => {
      try {
        const root = (await this.snapshot(new Set([parent]))).find((p) => p.pid === parent && p.parent === process.pid);
        if (!root) throw new Error('Cannot establish agent process ownership');
        this.rootBorn = root.born;
      } catch (error) { this.snapshotError = error; }
    })();
  }

  /** Runs after every operation queued before it, whether that one failed or not. */
  private then<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => {});
    return next;
  }

  private async table(extra: number[] = []) {
    return new Map((await this.snapshot(new Set([this.parent, ...this.owned.keys(), ...extra]))).map((p) => [p.pid, p]));
  }

  private signature() { return [...this.owned.values()].map((p) => `${p.pid}:${p.born}`).join('|'); }

  /** Called with the identities observed so far whenever that set has changed. */
  onChange?: (observed: { pid: number; born: string }[]) => void;

  track(pids?: number[]): Promise<void> {
    return this.then(async () => {
      if (this.snapshotError) throw this.snapshotError;
      const before = this.signature();
      const table = await this.table();
      // A snapshot also captures descendants of terminals we already know, before their parent
      // exits and they are reparented. No process is adopted just because Codex supplied its PID.
      for (const pid of pids ?? table.keys()) {
        const info = table.get(pid);
        let p = info;
        const seen = new Set<number>();
        const chain: ProcessInfo[] = [];
        while (p && !(p.pid === this.parent && this.rootBorn !== undefined && p.born === this.rootBorn) && this.owned.get(p.pid)?.born !== p.born && !seen.has(p.pid)) {
          seen.add(p.pid);
          chain.push(p);
          p = table.get(p.parent);
        }
        if (info && p && ((p.pid === this.parent && this.rootBorn !== undefined && p.born === this.rootBorn) || this.owned.get(p.pid)?.born === p.born)) {
          // A reported leaf proves the entire observed path, not just the leaf. Retain that path
          // so the intermediate processes remain attributable after the root dies.
          for (const member of chain.reverse()) this.owned.set(member.pid, member);
        }
      }
      // Keep registered identities until transport exit, including descendants whose leader ended.
      if (this.signature() !== before) this.onChange?.(this.observed());
    });
  }

  /**
   * Identities that Obeya's own liveness supervisor (the root) observed, never ones an agent
   * reported: each is kept only while its process still has the reported creation identity (to the
   * second on macOS, so a PID reused within that second passes). Unlike `track`, no ancestry is
   * needed, so they stay attributable after the supervisor has died.
   */
  adopt(reported: { pid: number; born: string }[]): Promise<void> {
    return this.then(async () => {
      if (this.snapshotError) throw this.snapshotError;
      const table = await this.table(reported.map((r) => r.pid));
      for (const { pid, born } of reported) {
        const current = table.get(pid);
        if (current?.born === born && pid !== this.parent) this.owned.set(pid, current);
      }
    });
  }

  /** Snapshot of previously observed identities, for report-only experiments; not signal authority. */
  observed(): { pid: number; born: string }[] {
    return [
      ...(this.rootBorn === undefined ? [] : [{ pid: this.parent, born: this.rootBorn }]),
      ...[...this.owned.values()].map(({ pid, born }) => ({ pid, born })),
    ];
  }

  kill(): Promise<void> {
    return this.then(async () => {
      if (!this.owned.size) return;
      // One refused signal (EPERM) must not leave the rest alive: every target is signalled, the
      // identities that could not be are kept for a later attempt, and the first failure is reported.
      const { signalled, failure } = terminate(this.owned.values(), await this.table());
      for (const pid of signalled) this.owned.delete(pid);
      if (failure === undefined) this.owned.clear();
      else throw failure;
    });
  }
}

/**
 * Signals the processes in `owned` that are still the ones recorded (same creation identity in
 * `table`), and every descendant of those: children that detached into another group while their
 * parent lived are still children in the table. Returns the pids that are gone or were signalled,
 * and the first failure. With `signalGroups` off, a group leader is signalled alone: a group number
 * proves nothing about who else is in the group. A recorded process whose pid now shows another birth is not a target.
 */
export function terminate(owned: Iterable<ProcessInfo>, table: Map<number, ProcessInfo>, signalGroups = true): { signalled: number[]; failure?: unknown } {
  const targets = new Map<number, ProcessInfo>();
  for (const info of owned) {
    const current = table.get(info.pid);
    if (current?.born === info.born) targets.set(current.pid, current);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of table.values()) if (targets.has(p.parent) && !targets.has(p.pid)) { targets.set(p.pid, p); changed = true; }
  }
  const signalled: number[] = [];
  let failure: unknown;
  for (const p of [...targets.values()].reverse()) {
    if (process.platform === 'win32') {
      // 128: no such process, i.e. it is already gone. Anything else (denied, timed out) is owed.
      const r = spawnSync('taskkill.exe', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 3000 });
      if (r.status !== 0 && r.status !== 128) { failure ??= r.error ?? new Error(`taskkill failed for ${p.pid} (${r.status})`); continue; }
    } else {
      try { process.kill(signalGroups && p.group === p.pid ? -p.pid : p.pid, 'SIGKILL'); } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ESRCH') continue;
        failure ??= e;
        continue;
      }
    }
    signalled.push(p.pid);
  }
  return { signalled, ...(failure === undefined ? {} : { failure }) };
}
