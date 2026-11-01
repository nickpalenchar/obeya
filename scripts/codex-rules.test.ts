import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { codexRules, prefixOf } from './codex-rules';

const root = join(import.meta.dir, '..');

test('a rule becomes a word prefix, unless a `*` stands inside a word', () => {
  expect(prefixOf('bun test *')).toEqual(['bun', 'test']);
  expect(prefixOf('bun run typecheck')).toEqual(['bun', 'run', 'typecheck']);
  expect(prefixOf('mkdir -p /tmp/obeya-*')).toBeNull();
  expect(prefixOf('node /x/obeya-*/demo.ts --dry')).toBeNull();
  expect(prefixOf('*')).toBeNull();
});

test('the committed Codex rules are the ones its allow list gives', () => {
  const { file, skipped } = codexRules(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'));
  expect(readFileSync(join(root, '.codex', 'rules', 'obeya.rules'), 'utf8')).toBe(file);
  expect(skipped.length).toBeGreaterThan(0);
  expect(file).not.toContain('decision="prompt"');
});
