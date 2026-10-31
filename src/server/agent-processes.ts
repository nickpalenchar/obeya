// Native PTYs can start a new process group: killing the app-server's group is not sufficient.
import { spawnSync } from 'node:child_process';

interface ProcessInfo { pid: number; parent: number; group: number; born: string }
function processes(): ProcessInfo[] {
  if (process.platform === 'win32') {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate | ConvertTo-Json -Compress'], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
    if (r.status !== 0) throw new Error('Cannot inspect agent process ownership');
    const rows: unknown = JSON.parse(r.stdout);
    return (Array.isArray(rows) ? rows : [rows]).flatMap((row) => {
      if (!row || typeof row !== 'object') return [];
      const p = row as Record<string, unknown>;
      return typeof p.ProcessId === 'number' && typeof p.ParentProcessId === 'number' && typeof p.CreationDate === 'string'
        ? [{ pid: p.ProcessId, parent: p.ParentProcessId, group: p.ProcessId, born: p.CreationDate }] : [];
    });
  }
  const r = spawnSync('ps', ['-axo', 'pid=,ppid=,pgid=,lstart='], { encoding: 'utf8', timeout: 3000 });
  if (r.status !== 0) throw new Error('Cannot inspect agent process ownership');
  return r.stdout.split('\n').flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    return m ? [{ pid: Number(m[1]), parent: Number(m[2]), group: Number(m[3]), born: m[4]! }] : [];
  });
}

/** Only register descendants while ownership is provable; remember their creation time against PID reuse. */
export class AgentProcesses {
  private owned = new Map<number, ProcessInfo>();
  constructor(private parent: number) {}

  track(pids?: number[]) {
    const table = new Map(processes().map((p) => [p.pid, p]));
    // A snapshot also captures descendants of terminals we already know, before their parent
    // exits and they are reparented. No process is adopted just because Codex supplied its PID.
    for (const pid of pids ?? table.keys()) {
      const info = table.get(pid);
      let p = info;
      const seen = new Set<number>();
      while (p && p.pid !== this.parent && this.owned.get(p.pid)?.born !== p.born && !seen.has(p.pid)) {
        seen.add(p.pid);
        p = table.get(p.parent);
      }
      if (info && p && (p.pid === this.parent || this.owned.get(p.pid)?.born === p.born) && pid !== this.parent) this.owned.set(pid, info);
    }
    // Keep registered identities until transport exit, including descendants whose leader ended.
  }

  kill() {
    if (!this.owned.size) return;
    const table = new Map(processes().map((p) => [p.pid, p]));
    const targets = new Map<number, ProcessInfo>();
    for (const info of this.owned.values()) {
      const current = table.get(info.pid);
      if (current?.born === info.born) targets.set(current.pid, current);
    }
    // Include children which detached into another group while the registered PTY was alive.
    let changed = true;
    while (changed) {
      changed = false;
      for (const p of table.values()) if (targets.has(p.parent) && !targets.has(p.pid)) { targets.set(p.pid, p); changed = true; }
    }
    for (const p of [...targets.values()].reverse()) {
      if (process.platform === 'win32') {
        spawnSync('taskkill.exe', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 3000 });
      } else {
        try { process.kill(p.group === p.pid ? -p.pid : p.pid, 'SIGKILL'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e; }
      }
    }
    this.owned.clear();
  }
}
