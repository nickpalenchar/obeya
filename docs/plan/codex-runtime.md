# Codex preview hardening, then Pi

Obeya owns the canvas, workspaces, conversations and owner decisions. Each harness owns its coding
loop. A role (coordinator, worker, explorer or small job) is not a harness or a model. The local
Codex worker preview is described in the permanent design chapters; this plan tracks what remains.

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
graceful shutdown waits; a forced shutdown is chosen precisely because the owner does not want to
wait, and stops remaining processes as best it can without waiting for them to finish. A crash is
separate and cannot run graceful shutdown. Check the observed transition against these semantics
before calling it a defect. All scratch servers stopped and
test-owned PIDs were cleaned up. Probe source and last report: `/tmp/obeya-keep-card-probe.ts`,
`/tmp/obeya-keep-card-report.json` on the test machine.

- [ ] Finish and review the current process-group and observed-descendant cleanup, including the
  Linux `/proc` changes. Check normal stop, forced stop and agent death, PID reuse, unrelated
  canaries and shutdown escalation. Verify how this interacts with app parking and `app.keep`;
  distinguish graceful shutdown, explicit forced shutdown and crashes. `app.keep` governs
  waiting-card parking; do not invent an app-process identity contract merely to keep the app alive
  through forced shutdown. Check how Codex's semantic background-terminal cleanup and process
  groups interact with those lifecycle choices. Native Windows and Linux Codex behavior remains
  unverified. Record the actual results and limitations, not a containment guarantee.
- [ ] Run comparable real Claude and Codex probes on macOS in scratch repositories and an isolated
  Obeya home: agent death and Obeya death, with a separately grouped background process and an
  unrelated canary. Check whether the app is meant to remain running, clean up every test-owned
  process, and report blocked authentication or incomplete runs rather than extrapolating.
- [ ] Before adding Pi, specify session work, the app governed by parking and `app.keep`, and
  external operations as distinct lifetimes. Use probe results to design and validate safe
  recovery of observed processes after an Obeya crash. This is not a Codex preview gate; it is
  a Pi gate. Recovery must not kill another live Obeya instance's processes or unrelated processes.
- [ ] Follow up with a liveness-pipe supervisor prototype, compared with or combined with a
  boot-aware persistent registry and startup sweep. Evaluate crash windows, concurrent instances,
  PID reuse, a supervisor's own failure, app ownership and cross-platform packaging. Neither
  sampling nor a registry recovers processes never observed; a supervisor is not containment.
- [ ] Investigate stronger platform boundaries separately: native Windows Job Objects with a
  gated launch, and Linux systemd user scopes including no-manager, no-D-Bus and read-only-cgroup
  fallback. Test native harnesses, nested jobs and breakaway, and preserve app parking semantics.
  macOS has no selected unprivileged equivalent. Do not claim an untested boundary or platform.

## Remaining phase 1 acceptance and parity
- [ ] Rerun live mixed-harness cards, rate-limit recovery and longer-running pause/restart scenarios.
- [ ] Expose the active session's own identity if working and reading bubbles should name its model.
- [ ] Explicit repository Codex configuration trust and configuration-change checks; until then,
  project `.codex` is rejected and the user's global Codex configuration is trusted.
- [ ] Decide whether native Codex pre-command hooks can provide the foreground-wait guard, rather
  than pretending Claude's hooks apply. Context updates currently use native completion/steering.
- [ ] Portable transcripts and work retrospectives, or continue showing them as unavailable.
- [ ] SSH, non-Git folder undo, contributor reviews and record/replay, each with its own parity tests
  before removing the current refusal. User/repository skill discovery is separate from bundled
  file-based skills already supplied to Codex.
- [ ] Harness selection for other roles once their permission/read-only/continuation contracts are
  implemented. Keeping the coordinator on Claude is a rollout boundary, not an architectural need.

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
