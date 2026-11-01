// A repository's allow list (`permissions.allow` of its `.claude/settings.json`, as the owner
// confirmed it in "Konfiguration") applied to a harness that has no such list of its own: Claude
// Code checks it itself, a Codex worker asks the owner for each command its sandbox does not
// cover. A command counts only when it is plain: one program with arguments, none of the shell's
// own syntax, so that a rule for `bun test *` never lets `bun test x; rm -rf y` through.

/** The patterns of the `Bash(...)` rules of a `.claude/settings.json` text; none where it does not read. */
export function bashRules(settingsText: string): string[] {
  try {
    const allow = (JSON.parse(settingsText) as { permissions?: { allow?: unknown } })?.permissions?.allow;
    if (!Array.isArray(allow)) return [];
    return allow.flatMap((r) => (typeof r === 'string' ? [/^Bash\((.*)\)$/s.exec(r)?.[1]] : [])).filter((p): p is string => !!p?.trim());
  } catch {
    return [];
  }
}

/** The words of `text` as a POSIX shell reads them between plain single and double quotes; null for any other shell syntax. */
function words(text: string): string[] | null {
  const out: string[] = [];
  let word: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "'") {
      const end = text.indexOf("'", i + 1);
      if (end < 0) return null;
      word = (word ?? '') + text.slice(i + 1, end);
      i = end;
    } else if (c === '"') {
      let j = i + 1;
      let part = '';
      for (; j < text.length && text[j] !== '"'; j++) {
        if (text[j] === '\\' || text[j] === '$' || text[j] === '`') return null;
        part += text[j];
      }
      if (j >= text.length) return null;
      word = (word ?? '') + part;
      i = j;
    } else if (c === ' ' || c === '\t') {
      if (word !== null) out.push(word);
      word = null;
    } else word = (word ?? '') + c;
  }
  if (word !== null) out.push(word);
  return out;
}

/** What the shell would give its own syntax a meaning with: none of it may be in a command a rule covers. */
const SYNTAX = /[;&|<>$`()\n\r\\{}!~#*?[\]]/;

/**
 * The plain command a request stands for: `/bin/zsh -lc '<command>'` (the shell Codex wraps a
 * command in) as the command inside it. Null for anything that is not one plain command.
 */
export function plainCommand(command: unknown): string | null {
  const argv = Array.isArray(command) ? command.map(String) : typeof command === 'string' ? words(command) : null;
  if (!argv?.length) return null;
  let text: string | null = null;
  if (/^(?:\/(?:usr\/)?bin\/)?(?:zsh|bash|sh)$/.test(argv[0]!)) {
    if (argv.length !== 3 || (argv[1] !== '-lc' && argv[1] !== '-c')) return null;
    text = argv[2]!;
  } else text = argv.join(' ');
  const inner = words(text);
  if (!inner?.length || SYNTAX.test(text.replace(/'[^']*'|"[^"]*"/g, ''))) return null;
  // `..` in a path would take a text pattern out of the directory it names
  if (inner.some((w) => w.split('/').includes('..'))) return null;
  return inner.join(' ');
}

/** Whether `rule` (a `Bash(...)` pattern, `*` for any text, a space before it making the word end there) covers `command`. */
function covers(rule: string, command: string): boolean {
  const parts = rule.trim().split('*');
  const star = parts.length > 1;
  if (!star) return rule.trim() === command;
  const escaped = parts.map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${escaped.join('.*')}$`, 's').test(command);
}

/** Whether an allow rule covers the command of an approval request: only then may it be granted without asking. */
export function allowed(rules: string[], command: unknown): boolean {
  const plain = plainCommand(command);
  return plain !== null && rules.some((r) => covers(r, plain));
}
