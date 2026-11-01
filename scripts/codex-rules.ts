// Writes `.codex/rules/obeya.rules`, the Codex form of the allow list in `.claude/settings.json`
// (one list, two harnesses): `bun scripts/codex-rules.ts`; `--check` only tells whether the file
// is up to date. Codex reads such rules of a project it trusts (`[projects."<path>"]` in
// ~/.codex/config.toml), takes a command inside `zsh -lc '…'` as the command it is, and asks
// for what no rule allows. A rule is a literal word prefix, so only a `Bash` rule that names its
// words (or ends in ` *` after them) fits; a rule with a `*` inside a path stays with Obeya, which
// applies the allow list to Codex workers itself (src/server/allow-rules.ts). A prefix also allows
// arguments after a rule that Claude Code reads as the exact command.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { bashRules } from '../src/server/allow-rules';

const root = resolve(import.meta.dir, '..');
const out = join(root, '.codex', 'rules', 'obeya.rules');

/** The rule's words as a Codex prefix, or null where a `*` stands for part of a word. */
export function prefixOf(rule: string): string[] | null {
  const words = rule.trim().split(/\s+/);
  if (words.at(-1) === '*') words.pop();
  return words.length && !words.some((w) => w.includes('*')) ? words : null;
}

export function codexRules(settingsText: string): { file: string; skipped: string[] } {
  const lines: string[] = [];
  const skipped: string[] = [];
  for (const rule of bashRules(settingsText)) {
    const prefix = prefixOf(rule);
    if (prefix) lines.push(`prefix_rule(pattern=${JSON.stringify(prefix)}, decision="allow")`);
    else skipped.push(rule);
  }
  const header = [
    '# Generated from .claude/settings.json by `bun scripts/codex-rules.ts`; edit that file, not this one.',
    '# A Codex rule is a word prefix: a Claude rule without a `*` (an exact command) allows arguments after it here.',
    '# Rules whose `*` stands inside a word have no form here; Obeya applies them itself to its Codex workers:',
    ...skipped.map((r) => `#   Bash(${r})`),
    '',
  ];
  return { file: [...header, ...lines, ''].join('\n'), skipped };
}

if (import.meta.main) {
  const { file } = codexRules(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'));
  if (process.argv.includes('--check')) {
    const same = existsSync(out) && readFileSync(out, 'utf8') === file;
    console.log(same ? 'up to date' : `${out} is out of date: run bun scripts/codex-rules.ts`);
    process.exit(same ? 0 : 1);
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, file);
  console.log(`wrote ${out}`);
}
