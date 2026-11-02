# Codex preview hardening, then Pi

Obeya owns the canvas, workspaces, conversations and owner decisions. Each harness owns its coding
loop. A role (coordinator, worker, explorer or small job) is not a harness or a model. The local
Codex worker preview is described in the permanent design chapters; this plan tracks what remains.

## Goal

Harden the local Codex worker preview and complete its remaining acceptance and parity work, then add Pi as a harness with the shared Obeya contracts.

## Workstreams

- [x] **W1:** Process cleanup. Finish and review the current process-group and observed-descendant cleanup, including the
  Linux `/proc` changes. Check normal stop, forced stop and agent death, PID reuse, unrelated
  canaries and shutdown escalation. Verify how this interacts with app parking and `app.keep`;
  distinguish graceful shutdown, explicit forced shutdown and crashes. `app.keep` governs
  waiting-card parking; do not invent an app-process identity contract merely to keep the app alive
  through forced shutdown. Check how Codex's semantic background-terminal cleanup and process
  groups interact with those lifecycle choices. Native Windows and Linux Codex behavior remains
  unverified. Record the actual results and limitations, not a containment guarantee.
- [x] **W2:** Comparable harness crash probes. Run comparable real Claude and Codex probes on macOS in scratch repositories and an isolated
  Obeya home: agent death and Obeya death, with a separately grouped background process and an
  unrelated canary. Check whether the app is meant to remain running, clean up every test-owned
  process, and report blocked authentication or incomplete runs rather than extrapolating.
- [ ] **W3:** Session lifetimes and crash recovery. Before adding Pi, specify session work, the app governed by parking and `app.keep`, and
  external operations as distinct lifetimes. Use probe results to design and validate safe
  recovery of observed processes after an Obeya crash. This is not a Codex preview gate; it is
  a Pi gate. Recovery must not kill another live Obeya instance's processes or unrelated processes.
  Launching agents through the liveness supervisor, and what must hold before that, belongs here
  (see "Liveness-pipe prototype: evaluation").
- [x] **W4:** Liveness-pipe prototype. Evaluated (2026-11-01): the two failure cases that reverted
  the first Codex transport integration are fixed in the prototype and have regression tests, and
  the transport's process identity is the agent's own, not the supervisor's. Verdict: combine it
  with the registry rather than adopt it alone, and keep it out of Obeya's launch path until W3; see
  "Liveness-pipe prototype: evaluation" below.
- [ ] **W5:** Platform process boundaries. Investigate stronger platform boundaries separately: native Windows Job Objects with a
  gated launch, and Linux systemd user scopes including no-manager, no-D-Bus and read-only-cgroup
  fallback. Test native harnesses, nested jobs and breakaway, and preserve app parking semantics.
  macOS has no selected unprivileged equivalent. Do not claim an untested boundary or platform.
- [ ] **W6:** Live phase 1 acceptance. Rerun live mixed-harness cards, rate-limit recovery and longer-running pause/restart scenarios.
- [ ] **W7:** Active session identity. Expose the active session's own identity if working and reading bubbles should name its model.
- [ ] **W8:** Codex configuration trust. Explicit repository Codex configuration trust and configuration-change checks; until then,
  project `.codex` is rejected and the user's global Codex configuration is trusted.
- [ ] **W9:** Foreground-wait guard. Decide whether native Codex pre-command hooks can provide the foreground-wait guard, rather
  than pretending Claude's hooks apply. Context updates currently use native completion/steering.
- [ ] **W10:** Transcripts and retrospectives. Portable transcripts and work retrospectives, or continue showing them as unavailable.
- [ ] **W11:** Feature parity. SSH, non-Git folder undo, contributor reviews and record/replay, each with its own parity tests
  before removing the current refusal. User/repository skill discovery is separate from bundled
  file-based skills already supplied to Codex.
- [ ] **W12:** Other harness roles. Harness selection for other roles once their permission/read-only/continuation contracts are
  implemented. Keeping the coordinator on Claude is a rollout boundary, not an architectural need.
- [ ] **W13:** Pi adapter. Implement the phase 2 adapter and its supported role contracts after the phase 1 gates.

## Verified checkpoint

Installed Codex CLI 0.162.0, on macOS, in scratch repositories and a scratch Obeya home:

- Native app-server transport and shared Obeya tools, file edits, reporting, active-turn messages,
  questions and owner replies, HTML handover, subprocess restart and restored tools.
- Selecting Codex through the real settings UI and discovering account models without a model turn.
- A real canvas card asking Blue/Green, restarting Obeya and changing the future default to Claude,
  then answering Blue and resuming the same Codex thread and resolved model.
- Owner permission denial and subsequent allow decisions through the existing question UI.
- Separate headless browser sessions for Codex and the test driver, desktop/mobile artifact checks,
  serving the actual HTML artifact in the card, approval and landing on the scratch repository's main.
- A real Codex card receives owner messages after defaults switch to Claude. A paused, undelivered
  answer survives server restart; resuming retains its thread/model and receives the next message.

## Focused hardening status

The acceptance pass used three independent read-only reviewers (including Codex), native scratch
runs and deterministic probes. Its nine findings have corresponding fixes and regression coverage:

| Area | Implemented check |
| --- | --- |
| Native PTYs outlive the app-server's process group | Track observed process descendants with creation identities, not arbitrary reported PIDs. A separate-group subprocess test leaves an unrelated PID alone; a real Codex PTY's heartbeat stops after app-server SIGKILL. |
| Main exits before shutdown escalation | Await transport shutdown before process exit. A subprocess regression awaits shutdown then exits; an EOF/TERM-ignoring server does not survive. |
| Ephemeral approval identities | Ignore callback ids, turn/item ids and timestamps, retain command and authority; equivalent reissued requests match, changed authority does not. |
| Broader file-change authority | Refuse `grantRoot` approvals and extended profiles rather than accepting session-wide authority as a one-call decision. |
| Denial instructions lost | Deliver the owner's explanation through model input after declining the native request; test steering receives the alternative. |
| Partial background completion | Each ended task wakes result inspection while persistent tasks remain; demonstrated with a native build plus a persistent server. |
| Polls extend timeout forever | Emit idle only on a transition or authoritative turn completion, not unchanged polling; regression tests cover repeated polls and the existing worker timeout. |
| Obsolete approval blocks later questions | Request resolution and turn completion abort and settle callbacks; a real Workers regression serializes another question afterwards. Session close preserves restartable questions. |
| Legacy Claude gets Codex skill menu | Legacy unqualified session ownership wins over changed defaults, tested before an explicit Codex pin selects its bundled skills. |

Process tracking is best-effort cleanup, not race-proof containment. A child that detaches and
loses its ancestry entirely between snapshots can escape observation. Native failure cleanup on
Windows/Linux native Codex cleanup is still unverified; do not expand the preview's platform
guarantees on the strength of the macOS result alone. On Linux, synthetic app-server tests run in an
ARM64 container without `ps`: an observed separately grouped child is killed after app-server death,
an unrelated process survives, and shutdown escalates. Linux process snapshots now read `/proc` and
use kernel start ticks, not `ps`'s second-resolution creation time. The app-server root is checked
against its recorded creation identity before new descendants are adopted. Numeric PID and process
group signalling still has a check-to-signal reuse race; start ticks are not a durable process handle.
This does not close the containment gap.

New speaker metadata persists the producing harness/model per utterance, including separate
Koordinator replies and researched answers. Concurrency/persistence tests keep identities isolated;
shared UI rendering and desktop/sidebar/phone screenshots cover the labels. Old messages are not
relabelled from current defaults; active working and reading bubbles do not identify the model.
Claude usage is independent of the worker harness: a live idle
Claude SDK fetch and the scratch UI both show it. The compact toolbar keeps percentages after
hiding the workspace pool; only its smallest stage hides them. No Codex usage is added.

### Verification limits

- Live concurrent Claude/Codex cards were blocked by Claude OAuth expiry during acceptance; a
  deterministic two-card test with real Git workspaces and fake sessions verifies message, question
  and permission isolation. A later idle Claude usage fetch succeeds, but is not a repeat of the
  live mixed-card test.
- A post-fix Codex review identified attribution losses in card logs and moved answers, since fixed;
  active working and reading bubbles remain unlabelled rather than guessing from earlier messages.
- Live rate-limit recovery and cross-platform cleanup remain unverified. Focused regression
  results are not a full-suite-green claim (the unrelated artifact-copy macro test is known to fail).
- The running owner's instance is never a test target; all probe jobs and scratch instances used
  for this pass are stopped after verification.

## Process cleanup: current work and follow-up

Current evidence (2026-10-31): on macOS, the process-tracking, Codex transport and runtime,
plus simulated parking/demo tests pass (87 tests); typecheck passes. A real Codex app-server
SIGKILL stopped an observed separately grouped background Python job (heartbeat stopped and its
PID disappeared). This was a runtime probe, not a full card or app-parking test; it did not test
Obeya's own death or an unrelated canary. The earlier Linux container tests were synthetic;
Windows and native Linux Codex remain unverified. An initial broad Codex review timed out; a
subsequent narrow review identified the already-known snapshot-to-signal PID/PGID reuse race and
also the unverified app-server group signal after `exit` and `close`, when its numeric group ID may
have been reused. Neither risk is resolved. An initial test run was blocked by an inaccessible
stale temporary directory; an isolated TMPDIR allowed the tests to run.

The lifecycle boundary remains open: the tracker kills observed descendants on app-server exit,
without distinguishing an app protected by `app.keep` from session work. Simulated parking tests
alone do not establish what happens to a real app launched under Codex on session shutdown.
Determine the intended lifecycle and exercise it with a real process before treating this as safe.

Paired macOS runtime probes (2026-10-31) launched a real background Python heartbeat under each
agent in separate scratch repositories. Each heartbeat was in a different process group from its
agent; an unrelated canary survived all four cases. After SIGKILL of the runtime host, the observed
Codex app-server and heartbeat exited, while Claude and its heartbeat survived (the heartbeat
advanced from 40 to 57 in 1.8 seconds). After SIGKILL of the agent, the Codex heartbeat stopped
and disappeared; Claude's heartbeat survived and advanced from 37 to 54. The short-lived runtime
host also exited after agent failure, unlike the Obeya server, so these results do not establish
behavior of a still-running server. All observed test-owned processes were explicitly cleaned up.
The Codex owner-death result is an observation of this run, not a crash-containment guarantee;
the Claude result makes crash cleanup relevant to both harnesses. No `app.keep` or real card was
involved. Probe and detailed output: `/tmp/obeya-runtime-owner-crash.ts` and
`/tmp/obeya-{owner,agent}-crash-{codex,claude}.log` on the test machine.

Real Codex card probes (2026-10-31) used a scratch server and trusted settings whose `app.keep`
logs and succeeds, while `app.stop` logs and signals the test app. A Python heartbeat launched as
a native background terminal was alive on a waiting question, but `app.keep` had not run while
that background task remained active. On graceful Obeya shutdown the heartbeat stopped; neither
settings command had run. A second attempt launched it via a shell `&` with redirected stdio: the
app was already dead by the time `app.keep` ran, while `app.stop` did not run. Thus neither
attempt demonstrates that an app which `app.keep` actually protected survives session closure;
the latter can even report keeping an app that already exited. A third launcher created a separate
session for the heartbeat and remained its parent for 1.5 seconds so it could be observed. Here
`app.keep` ran while the heartbeat was alive (57 ticks); graceful server shutdown then killed it
(58 ticks, PID gone), without invoking `app.stop`. **Decision (owner, 2026-10-31):** `app.keep`
protects an app from waiting-card parking, not an unconditional right to survive shutdown. A
graceful shutdown waits up to the existing 15-minute limit for busy workers; a forced shutdown is
chosen precisely because the owner does not want to wait, and stops remaining processes as best it
can without waiting for them to finish. A crash is separate and cannot run graceful shutdown.
The stop scheduler waits for busy workers and supports an immediate owner override, with regression
tests for both and for the deadline. Forced stop signals the tracked processes immediately instead
of waiting for Codex's normal EOF/TERM/KILL escalation; a synthetic macOS test checks a separately
grouped child and unrelated canary. Ordinary shutdown still waits for escalation. The card probe
above had no busy worker at shutdown, so it does not verify graceful waiting or this forced path
with a real card. All scratch servers stopped and
test-owned PIDs were cleaned up. Probe source and last report: `/tmp/obeya-keep-card-probe.ts`,
`/tmp/obeya-keep-card-report.json` on the test machine.

W1 closing pass (2026-11-01, macOS, Codex CLI 0.162.0, scratch directories, no model turn;
`scripts/process-lifecycle-probe.ts`). The probe drives the installed app-server through Obeya's
transport, starts three Python heartbeats with `thread/shellCommand` (in the shell's group, in a
session of its own, in a session of its own whose launcher exits early) and an unrelated canary,
then ends things four ways:

| Case | Heartbeats | App-server | Canary |
| --- | --- | --- | --- |
| Graceful transport close | all three stopped | gone | alive |
| Forced close (`endCodexHere(true)`) | all three stopped | gone | alive |
| SIGKILL of the app-server (the host lives) | all three stopped | gone | alive |
| SIGKILL of the host (no tracker left to run) | **all three kept running** | gone (stdin EOF) | alive |

So cleanup follows from the host's tracker, not from Codex: when Obeya itself dies, the
separately grouped and the same-group jobs alike outlive it. This differs from the earlier
host-death probe above, where the heartbeat stopped; the earlier job was most likely a Codex-managed
terminal that the app-server ended itself on EOF, whereas `shellCommand` jobs are not. Treat the host-death result as
"depends on how Codex started the process", never as a guarantee either way. Crash recovery is W3/W4.

Review changes from this pass: a refused signal (EPERM) no longer leaves the other observed
processes alive, and the identities still owed are kept and retried when the transport's pipes
close; a Windows `taskkill` failure other than "not found" is reported and retried, not forgotten
(untested on Windows); the app-server's group is signalled once at `exit`, never again by later
escalation timers (a test pins it); the probe itself only signals pids that still look like its own.
Open, by nature of numeric signalling: that one group signal at `exit` and every snapshot-to-signal
kill can reach a reused number if the group emptied and the number was recycled in between.

Lifecycle summary, as verified: for Codex, normal and forced stop and agent death end session work
(observed descendants and the app-server's group), unrelated processes are left alone, and
`app.keep` is not involved: it only decides whether a waiting card's app is stopped by parking. An
app started as session work dies with its session on any shutdown, graceful or forced; one the owner
wants to outlive a shutdown needs a handoff that does not exist (W3). A crash of Obeya runs no
cleanup. A Claude agent's death ends nothing it started outside its own process group (W2 below).

W2 comparable crash probes (2026-11-02, macOS 26.6.2, Claude Code 2.1.316 through the
Agent SDK, Codex CLI 0.162.0 app-server, Bun 1.3.14; `scripts/harness-crash-probe.ts`). Each case
stages its own scratch Obeya with real workers, repository and `OBEYA_HOME`, trusts settings whose
`app.keep` logs and exits 0 and whose `app.stop` logs and kills the app, and starts one card (Claude
Sonnet, low effort; Codex account default, low effort). The worker runs `python3 job.py`, which forks
a heartbeat into a session and process group of its own and keeps it as its child for three
seconds, then asks a question. Once the card waits and parking (`OBEYA_PARK_GRACE=2`) ran `app.keep`,
so the app is one Obeya means to keep running while the card waits, the probe SIGKILLs the worker's
agent process (the `claude` binary, or `codex app-server`) or the Obeya server, and looks 8 s later.
An unrelated canary in its own session runs throughout. Repetitions: Claude agent death 5, the other
three cases 3 each (Codex agent death also once more in a trial); every case measured, none blocked.

| Case | App (separate group, kept by `app.keep`) | Agent | Server | Canary | Card |
| --- | --- | --- | --- | --- | --- |
| Claude, agent SIGKILL | **kept running** (~80 ticks in 8 s, every time) | gone | alive | alive | still asks; log: "Claude Code process terminated by signal SIGKILL" |
| Codex, agent SIGKILL | stopped at once (0–1 ticks, pid gone, every time) | gone | alive | alive | still asks; log: "Codex app-server exited (SIGKILL)", then parking's "the app keeps running" |
| Claude, Obeya SIGKILL | **kept running** | exited (stdin EOF) | gone | alive | unchanged in the database |
| Codex, Obeya SIGKILL | **kept running** | exited (stdin EOF) | gone | alive | unchanged in the database |

What this says about whether the app is meant to keep running:

- Codex agent death matches the design: observed session work ends whatever `app.keep` says. But
  parking runs `app.keep` again once the app-server is gone and logs on the card that the app keeps
  running, after the tracker had already killed it: the card tells the owner the opposite of what
  happened (in every Codex agent-death run).
- Claude agent death leaves a separately grouped app running, kept or not: Claude workers have no
  descendant tracking, and Obeya signals nothing when one dies. The design does not say whether that is
  meant; it is the same outcome as an Obeya crash, but with Obeya still running and able to clean up.
  This makes recovery after agent death a W3 question for both harnesses, not only for Codex.
- Obeya death: both harnesses' agents exit on their own once their stdin closes; the separately
  grouped app outlives Obeya for both, as the design says of a crash (no cleanup runs). Nothing marks
  the card: it still asks in the database. In one of three Claude runs another Claude process of the
  server (not the worker's; most likely the Koordinator's or a small job's) and the MCP servers from
  the machine's user-level Claude configuration were still alive 8 s after the server's death.
- In no case did a card show the owner that its worker was gone beyond the error line in its log;
  what an answer to the still-open question does next (resume, error, a second app) was not tested.

Cleanup: after each case the probe stops the scratch server (`--stop`), kills every heartbeat
working in the case's directory (found by working directory, not by pid file) and every process it
saw under the server that still has the same command, then checks that none is left; every case
reported clean (the first trial run, whose cleanup missed its scratch server, aside: that server was
gone when checked by hand), and a final `ps` found no probe process. Not covered: Linux and Windows,
an agent killed mid-turn instead of while waiting, a same-group background job, the app started by a
native Codex background terminal (W1 covers that through the transport alone), and resuming after
the crash.

### Proposed recovery boundary (not implemented)

Use the supervisor and a registry for different failures, not as substitutes. A private liveness
pipe lets the session's supervisor react when its Obeya server dies. A durable registry is a fallback
for a supervisor that dies, or cleanup it could not complete; it does nothing until a later sweep.
Neither makes an unobserved descendant recoverable. The prototypes below have no startup sweep and
must not be treated as providing this design.

A separate **report-only** prototype in `scripts/agent-registry-prototype.ts` explores a
per-generation SQLite write-lock lease and atomic record replacement in a private local scratch
directory. The lease is held independently of the record file; an inspector cannot read a generation
while its lease is held, and an owner process's death releases it. Records carry a supervisor and
observed process identities; Linux identity reads boot ID, PID namespace and `/proc` start ticks.
Other platforms report identity unavailable. An inspector reports match, different, or
missing-or-hidden, and treats a missing/busy lease, corrupt record or mismatched boot/namespace as
unknown. It never kills processes or deletes records. Tests use synthetic identities and exercise a
separate owner's death on macOS. The supervisor can optionally write the registry on Linux in a
scratch directory: it establishes its lease before launch and records observed identities whose
start ticks still match, retaining previous observations. A shell waits on a private pipe before
executing agent code; the supervisor first records the gated child's identity, then releases it.
A Linux ARM64 container test checks that record from the first line of child code. The record is
fsynced along with its directory before release; filesystem and lease durability under power loss,
initial directory creation, and write-failure boundaries remain unverified. A crash between later
observation and publication still loses that observation. A synthetic Linux ARM64 container test
kills the supervisor and inspects the surviving worker and
separately grouped child; neither is killed by the report. Windows, hostile paths, power-loss durability,
filesystem lock behavior beyond local tests, real agents and packaged Obeya are unverified. This is
not a production registry, a startup sweep or proof that an identity is safe to signal.

- **Lifetime:** each local agent session gets a random, never-reused session generation and a
  supervisor. Session work belongs to it; a card's `app.keep` affects parking, not forced shutdown.
  External operations and remote hosts are not assumed to be session-owned. An app that needs an
  independent lifetime cannot be identified or protected by ancestry alone; no such handoff is
  specified yet. An ordinary session end and owner-pipe EOF both trigger cleanup, while a graceful
  server stop waits for busy turns as described above. No command-line search or workspace-wide
  kill is an ownership boundary.
- **Ownership:** the supervisor holds an exclusive, kernel-backed per-generation lease while it can
  own or clean up the session. Another Obeya instance or startup sweeper must acquire that same
  lease non-blockingly and keep it throughout inspection, signalling and record updates; a busy,
  missing, inaccessible, unsupported or ambiguous lease is *not* permission to kill. Lease files
  must not be unlinked and recreated while contenders may hold the old inode. Use a private local
  directory, secure permissions and paths that cannot be redirected; define and test platform lock
  semantics before relying on them. A random id or an owner PID alone is not a lease.
- **Records:** persist a versioned record per generation containing the host and boot identity,
  supervisor identity, and only observed session-process identities (PID plus a sufficiently
  precise kernel creation identity), with the session generation and lifecycle state. Do not store
  credentials or full command lines. Use atomic, crash-safe updates and serialize updates with the
  lease; keep a record when writing, inspecting or cleanup fails, rather than declaring success.
  Boot, host, PID namespace, identity format and lock backend must match the observer's environment;
  an unknown, corrupt, old, inaccessible or incompatible record is quarantined and reported, never
  guessed at. A filesystem shared across hosts or PID namespaces is not by itself a common process
  ownership domain.
- **Ordering:** a gated launch must establish the lease and durable initial record before agent code
  is allowed to run. As processes are observed, persist identities before relying on the registry
  to recover them. A crash before persistence or between observations still leaves a gap: the gate
  does not make later children atomic. Close or crash triggers immediate best-effort supervisor
  cleanup; mark the generation finished and remove its record only after cleanup is known to have
  completed. A crash during record updates or cleanup leaves it eligible for a later retry once the
  lease is available. Concurrent sweepers must not both clean the same generation.
- **Sweep:** only after obtaining the lease and establishing same-host, same-boot, same-namespace
  identities may a sweep consider an individual recorded process. Missing or mismatched processes
  are not targets; a live process whose identity cannot be established is left alone and reported.
  Verification followed by `kill(pid)` or `killpg(pgid)` still races reuse, and a group number does
  not prove every member is owned. Automatic destructive recovery requires an OS mechanism that
  safely binds signalling to the verified process identity; until one is selected and tested on a
  platform, its sweep is report-only. In particular, macOS `ps` second-resolution start times and
  numeric group IDs are insufficient for that guarantee. Linux pidfds and Windows process handles
  are candidates, not yet a verified complete design; neither discovers unseen children.
- **Acceptance before integration:** exercise crashes at each launch, registration and cleanup
  boundary; an owner and supervisor dying independently; concurrent instances and sweepers;
  reboot, namespace and PID reuse; invalid records, permissions and failed writes; normal and
  forced stop; kept apps and unrelated canaries. Test real Claude and Codex, packaging, and each
  supported OS. A failed or unavailable recovery must be visible and must not silently widen the
  kill scope. Preserve the distinction between a session that can safely resume and one whose old
  writer is still unaccounted for.

### Liveness-pipe prototype: evaluation

`scripts/agent-liveness-prototype.ts` (the supervisor) and `scripts/agent-liveness-owner.ts` (its
caller) are POSIX-only experiments; Obeya does not launch agents through them. The build bundles the
supervisor as a resource, and a macOS compiled-binary smoke test ran it with `BUN_BE_BUN=1`.

How they work. The caller starts the supervisor in a group of its own with two private pipes: a
liveness pipe whose write end only the caller holds, and a report pipe the supervisor writes to.
The supervisor launches the agent in a group of its own behind a gate (a shell that waits on a
third private pipe, then closes it and execs the agent), so none of the three pipes reaches the
agent. It samples the agent's descendants every 100 ms and, through the report pipe, tells the
caller each identity it observes (PID plus creation time), the agent's first and before agent code
runs. The caller adopts each reported identity only while a process still has that creation
time; no ancestry is needed, so the identities stay attributable after the supervisor has died
and its processes have been reparented. On liveness-pipe EOF or agent exit, the supervisor kills
the observed processes, then signals the agent's group once. When the supervisor exits, for any
reason, the caller signals every adopted identity that still matches, plus their children at that
moment. The caller acts on the supervisor's `exit`, not on its pipes closing: the agent inherits
the supervisor's stdio, so after a supervisor SIGKILL a reparented agent still holds them.

The two failures that reverted the first Codex transport integration, and their regression tests
(`scripts/agent-liveness-prototype.test.ts`; each was checked to fail with its fix removed):

- *Supervisor SIGKILL while the agent holds its pipes.* A synthetic agent starts a separately
  grouped leaf; the supervisor is killed after reporting it. The caller's `done` settles while the
  supervisor's stdout is still held open, both agent and leaf are stopped, an unrelated canary
  survives. The agent identity the caller receives is the agent's, distinct from the supervisor's.
- *Fast agent exit.* The agent starts a same-group child and exits before the first sample. The
  group signal at exit stops the child; a canary survives.

Two more tests: neither the liveness nor the report pipe is open in the agent, and ending one of two
concurrent supervisors' pipes stops only its own agent. All pass on macOS and in a Linux ARM64
container (Bun 1.3.14, 2026-11-01), together with the earlier registry tests. These are synthetic
processes, not a real Claude or Codex harness, and nothing was run on Windows.

What the combination covers, by what dies:

| Dies | Who cleans up | Left over |
| --- | --- | --- |
| Obeya server | supervisor, on liveness-pipe EOF | descendants not yet sampled that left the agent's group |
| supervisor | caller, from the adopted identities | the same, and a same-group child of an agent that also exited already |
| both (power loss, OS killing both) | nobody until a registry sweep, Linux report-only today | everything |

Verdict: combine, do not adopt alone. The supervisor answers the server's death, the caller's
adoption answers the supervisor's death, and only a durable registry with a startup sweep (above)
can answer both dying; none of them makes an unobserved descendant recoverable. Before agents are
launched through it (W3):

- *Normal shutdown.* Liveness EOF means SIGKILL at once. Graceful stop (busy turns, Codex's
  EOF/TERM/KILL escalation) must stay with the server over the transport; the pipe is only for the
  server's death, and an ordinary stop closes it only after the transport has finished.
- *Apps and external work.* Everything observed under the agent dies with the session, including an
  app `app.keep` protects from parking, which matches the owner's decision that a crash ends session
  work. Work outside the agent's ancestry (a daemon's children, containers, remote hosts) is not
  reached and not owned.
- *Concurrent instances.* Each session has its own pipes and process groups; nothing is found by
  search. A startup sweep across instances still needs the registry's lease.
- *Remaining windows.* A descendant that leaves the agent's group between two samples; a fast agent
  exit combined with a supervisor death; macOS creation times have one-second resolution; every
  numeric signal (PID or group) races reuse; the group signal at exit can reach a reused number once
  the group has emptied.
- *Packaging.* POSIX only, with `/bin/sh` as the gate; Windows needs a different mechanism (W5). A
  compiled Obeya must start the bundled resource with `BUN_BE_BUN=1`, which the caller side does
  not set yet.
- *Both harnesses.* Claude's processes survived the host's death in the probes above; the launch path
  should be shared by Claude and Codex, not a Codex transport detail.

## Phase 2: Pi

An installed `pi --mode rpc` subprocess is the preferred first adapter; an embedded SDK is an
alternative if tighter control outweighs isolation. Register the same Obeya tools through a Pi
extension. Reuse harness-aware settings and pinned session ownership. Map messages, steering,
persistence and `agent_settled` (not merely `agent_end`) to the shared contract. Support standard
extension dialogs explicitly; arbitrary TUI extensions are outside the initial scope. The
coordinator can then select Pi once that role's contracts are supported, just like workers.

Estimated difficulty after a sound phase 1: a basic Pi worker is moderate, roughly 3–7 engineering
days; polished installed-extension/configuration/recovery support likely adds 1–2 weeks. These
are planning ranges, contingent on the supported extension set and remaining phase 1 gates.
