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

## Remaining phase 1 acceptance and parity

- [ ] Stronger process containment for descendants that escape between observations; native PTY
  cancellation and shutdown escalation on Windows/Linux as well as macOS. Linux cgroup v2 with
  atomic placement and `cgroup.kill` requires a delegated writable subtree (not available in a
  normal Docker container with a read-only cgroup mount). Windows job objects need an atomic
  suspended start and assignment before the process can fork; nested-job and breakaway behavior
  require testing. macOS process groups do not contain a descendant that creates a new session.
  No portable containment boundary has yet been chosen or implemented; avoid treating these
  mechanisms or synthetic tests as a verified replacement for the current best-effort cleanup.
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
