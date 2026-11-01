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
- Owner permission denial and subsequent allow decisions through the existing question UI. Approval
  identity preserves the command and permission scope, not ephemeral turn/item identifiers.
- Separate headless browser sessions for Codex and the test driver, desktop/mobile artifact checks,
  serving the actual HTML artifact in the card, approval and landing on the scratch repository's main.
- Contract tests for routing, pinning, legacy Claude sessions, unsupported capabilities, arguments,
  thread/turn scope, message races, permission cancellation, background accounting and bounded shutdown.
- Codex second review: record/replay cannot fall through to Claude; bare non-Git folders are refused.

The preview is available in the app, not merely in the terminal probe. Unsupported capabilities
fail explicitly. No silent harness/model fallback; locators alone never authorize another card's
session. The running owner's instance is not a test target.

## Remaining phase 1 acceptance and parity

- [ ] Live background-terminal accounting, completion wakeup and cleanup, including process death.
- [ ] Live permission cancellation and shutdown escalation on Windows and Linux as well as macOS.
- [ ] Concurrent mixed-harness cards, rate-limit recovery and longer-running pause/restart scenarios.
- [ ] Explicit repository Codex configuration trust and configuration-change checks; until then,
  project `.codex` is rejected and the user's global Codex configuration is trusted.
- [ ] Decide whether native Codex pre-command hooks can provide the foreground-wait guard, rather
  than pretending Claude's hooks apply. Context updates currently use native completion/steering.
- [ ] Portable transcripts and work retrospectives, or continue showing them as unavailable.
- [ ] SSH, non-Git folder undo, contributor reviews and record/replay, each with its own parity tests
  before removing the current refusal. User/repository skill discovery is separate from the bundled
  file-based skills already supplied to Codex.
- [ ] Harness selection for other roles, once their permission/read-only/continuation contracts are
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
are planning ranges, contingent on the supported extension set and remaining phase 1 findings.
