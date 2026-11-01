import { expect, test } from 'bun:test';
import { allowed, bashRules, plainCommand } from './allow-rules';

const rules = [
  'bun install',
  'bun test *',
  'bun run typecheck',
  'mkdir -p /tmp/obeya-*',
  'node /Users/nick/demos/obeya-*/demo.ts',
  'codex exec --sandbox read-only review --base main',
];
const zsh = (script: string) => `/bin/zsh -lc '${script}'`;

test('rules are the Bash patterns of a settings file', () => {
  expect(bashRules(JSON.stringify({ permissions: { allow: ['Bash(bun install)', 'Read(x)', 'Bash(bun test *)', 5] } }))).toEqual(['bun install', 'bun test *']);
  expect(bashRules('not json')).toEqual([]);
  expect(bashRules('{}')).toEqual([]);
});

test('a plain command, wrapped in the shell Codex runs it in or not, is covered by its rule', () => {
  expect(allowed(rules, zsh('bun install'))).toBe(true);
  expect(allowed(rules, zsh('bun test src/server/board.test.ts --parallel'))).toBe(true);
  expect(allowed(rules, 'bun run typecheck')).toBe(true);
  expect(allowed(rules, ['/bin/zsh', '-lc', 'mkdir -p /tmp/obeya-demo'])).toBe(true);
  expect(allowed(rules, zsh('node /Users/nick/demos/obeya-x/demo.ts'))).toBe(true);
  expect(allowed(rules, zsh('codex exec --sandbox read-only review --base main'))).toBe(true);
});

test('what no rule covers is not allowed, and neither is a longer or shorter command', () => {
  expect(allowed(rules, zsh('bun install left-pad'))).toBe(false);
  expect(allowed(rules, zsh('bun run typecheck --watch'))).toBe(false);
  expect(allowed(rules, zsh('bun test'))).toBe(false);
  expect(allowed(rules, zsh('bunx test x'))).toBe(false);
  expect(allowed(rules, zsh('git push'))).toBe(false);
  expect(allowed([], zsh('bun install'))).toBe(false);
  expect(allowed(rules, undefined)).toBe(false);
});

test('shell syntax never rides on a rule', () => {
  for (const script of [
    'bun test x; rm -rf y',
    'bun test x && rm -rf y',
    'bun test x || true',
    'bun test x | tee out',
    'bun test x > /etc/passwd',
    'bun test $(rm -rf y)',
    'bun test `id`',
    'bun test "$HOME"',
    'bun test x\nrm -rf y',
    'bun test *.ts',
    'bun test ~/x',
    'bun test x & ',
    'mkdir -p /tmp/obeya-x/../../etc/y',
    'node /Users/nick/demos/obeya-../../x/demo.ts',
  ]) expect([script, allowed(rules, zsh(script))]).toEqual([script, false]);
});

test('only one shell wrapper of the plain form counts', () => {
  expect(plainCommand("/bin/zsh -lc 'bun install'")).toBe('bun install');
  expect(plainCommand("/bin/zsh -lc 'bun install' extra")).toBeNull();
  expect(plainCommand("/bin/zsh -c 'bun install'")).toBe('bun install');
  expect(plainCommand("/bin/zsh -lc 'bun install")).toBeNull();
  expect(allowed(rules, "env FOO=1 /bin/zsh -lc 'bun install'")).toBe(false);
});
