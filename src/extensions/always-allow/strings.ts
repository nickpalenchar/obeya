// What „Immer erlauben“ says on the card, in both languages.

import type { Language } from '../../core/locale';

const de = {
  option: (rules: string[]) => `Immer erlauben: ${rules.join(', ')}`,
  where: '„Immer erlauben“ nimmt die Regel in die Erlaubnisliste des Repositorys auf (.claude/settings.json auf main, für Claude und Codex); dann fragt kein Agent mehr danach.',
  added: (rules: string[], branch?: string) => `In die Erlaubnisliste aufgenommen${branch ? ` und auf ${branch} committet` : ''}: ${rules.join(', ')}`,
  already: (rules: string[]) => `Schon in der Erlaubnisliste: ${rules.join(', ')}`,
  failed: (rules: string[], why: string) => `Einmal erlaubt; in die Erlaubnisliste ließ sich ${rules.join(', ')} nicht aufnehmen: ${why}`,
};

const en: typeof de = {
  option: (rules) => `Always allow: ${rules.join(', ')}`,
  where: '“Always allow” adds the rule to the repository’s allow list (.claude/settings.json on main, for Claude and Codex), so no agent asks for it again.',
  added: (rules, branch) => `Added to the allow list${branch ? ` and committed on ${branch}` : ''}: ${rules.join(', ')}`,
  already: (rules) => `Already in the allow list: ${rules.join(', ')}`,
  failed: (rules, why) => `Allowed once; ${rules.join(', ')} could not be added to the allow list: ${why}`,
};

export const STRINGS: Record<Language, typeof de> = { de, en };

/** `pick`'s text in every language. */
export const inEvery = (pick: (s: typeof de) => string): Record<Language, string> => ({ de: pick(de), en: pick(en) });
