import { expect, test } from 'bun:test';
import { allowed, bashRules, plainCommand, plainCommands } from './allow-rules';

const rules = [
  'bun install',
  'bun test *',
  'bun run typecheck',
  'mkdir -p /tmp/obeya-*',
  'node /Users/nick/demos/obeya-*/demo.ts',
  'codex exec --sandbox read-only review --base main',
];
const zsh = (script: string) => `/bin/zsh -lc '${script}'`;
/** As Codex writes a script that holds quotes itself: in double quotes, with the quotes inside escaped. */
const zshq = (script: string) => `/bin/zsh -lc "${script.replace(/(["\\$`])/g, '\\$1')}"`;

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

const more = [...rules, 'node /Users/nick/harness/obeya/plugin/skills/browser/lib/browser.ts start', 'node /Users/nick/harness/obeya/plugin/skills/browser/lib/browser.ts open *', 'node /Users/nick/harness/obeya/plugin/skills/browser/lib/browser.ts eval *'];
const browser = 'node /Users/nick/harness/obeya/plugin/skills/browser/lib/browser.ts';

test('a chain is covered where every part of it is', () => {
  expect(allowed(more, zshq(`${browser} start && ${browser} open 'http://127.0.0.1:4484/login?token=abc&next=%2F'`))).toBe(true);
  expect(allowed(more, zsh(`${browser} start; bun run typecheck\nbun install`))).toBe(true);
  expect(allowed(more, zshq(`${browser} eval "({pressed:document.querySelector('.x')?.getAttribute('aria-pressed')})"`))).toBe(true);
  // the very command Codex asked about: five calls in one script, quotes and parentheses inside its quotes
  expect(allowed(more, zshq(`${browser} start && ${browser} open 'http://127.0.0.1:4484/login?token=a&next=%2F%3Fc%3Ddemo' && ${browser} eval "({mode:document.querySelector('video')?.textTracks[0]?.mode})"`))).toBe(true);
  // an escaped dollar in the outer quotes is the script's own expansion
  expect(allowed(more, zshq(`${browser} eval "$HOME"`))).toBe(false);
  // one part no rule covers, or any other way of joining them
  expect(allowed(more, zsh(`${browser} start && git push`))).toBe(false);
  expect(allowed(more, zsh(`${browser} start || bun install`))).toBe(false);
  expect(allowed(more, zsh(`${browser} start | tee x`))).toBe(false);
  expect(allowed(more, zsh(`${browser} start & bun install`))).toBe(false);
  expect(allowed(more, zsh(`(${browser} start)`))).toBe(false);
  expect(allowed(more, zsh(`bun install && `))).toBe(true);
  expect(allowed(more, zsh(' && '))).toBe(false);
});

test('variables in front of a command and output to a temporary file do not hide what runs', () => {
  expect(allowed(rules, zsh('TMPDIR=/private/tmp/obeya-x bun test --parallel'))).toBe(true);
  expect(allowed(rules, zsh('TMPDIR=/private/tmp/obeya-x bun test --parallel > /private/tmp/obeya-x.log 2>&1'))).toBe(true);
  expect(allowed(rules, zsh('bun test a >> /tmp/obeya-x.log'))).toBe(true);
  expect(plainCommands(zsh('FOO=1 BAR=2 bun test a > /tmp/x.log 2>&1'))).toEqual(['bun test a']);
  // a variable that changes what a program is, a redirect to anywhere else, input, descriptors other than 1 and 2
  for (const script of [
    'PATH=/tmp/evil bun test a',
    'NODE_OPTIONS=--require=/tmp/x bun test a',
    'GIT_SSH_COMMAND=x bun test a',
    'bun test a > /etc/passwd',
    'bun test a > ~/x',
    'bun test a > /tmp/../etc/x',
    'bun test a > /tmp/x.log 2>&2',
    'bun test a < /tmp/in',
    'bun test a 3> /tmp/x',
    'bun test a > $HOME/x',
    'bun test "a > /etc/x" > /etc/y',
  ]) expect([script, allowed(rules, zsh(script))]).toEqual([script, false]);
  // `>` between quotes is an argument, not a redirect
  expect(allowed(rules, zsh('bun test "a > b"'))).toBe(true);
});

test('where the temporary directories are can be told', () => {
  expect(allowed(rules, zsh('bun test a > /var/scratch/x.log'), ['/var/scratch/'])).toBe(true);
  expect(allowed(rules, zsh('bun test a > /tmp/x.log'), ['/var/scratch/'])).toBe(false);
});
