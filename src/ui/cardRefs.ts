// Other cards named in a card's text: `/` in its task field opens a menu of the canvas's cards whose
// titles fit what follows, and the one picked stands in the text as a markdown link to its address
// (`[Title](/c/<canvas>/card/<code>)`). Wherever the text is shown, such a link is a smart link: a
// pill with the card's state, its current title and its priority (`SmartLink`). The agent reads the
// link as it stands: the card's title, and where it lives.

import type { Item } from '../core/types';
import { cardPath, named } from './address';
import { know, known } from './known';

/** Set once the owner has picked a card from the menu: its hint under the field goes. */
export const CARD_REFS_KNOWN = 'obeya-card-refs-known';
export const usedCardRefs = () => know(CARD_REFS_KNOWN);
export const knowsCardRefs = () => known(CARD_REFS_KNOWN);

/** How many cards the menu lists at most. */
const SHOWN = 8;

/** A `/` search the cursor stands at the end of: where its slash is in the text, and what follows it. */
export interface CardSearch {
  start: number;
  query: string;
}

/**
 * The `/` search ending at `caret`: a slash at the start of the text or after a space, and the words
 * after it on the same line (a title has spaces), at most a few. A path (`/a/b`) is none.
 */
export function cardSearchAt(text: string, caret: number): CardSearch | null {
  const m = /(?:^|\s)\/([^\n/]{0,60})$/.exec(text.slice(0, caret));
  if (!m || /^\s/.test(m[1]!)) return null;
  return { start: caret - m[1]!.length - 1, query: m[1]! };
}

/**
 * The cards that fit `query`, case aside: each of its words is in the title or is the card's short
 * code; titles that start with the query first, then the rest, each group as listed. Not `self`,
 * nor what is archived.
 */
export function matchingCards(items: Item[], query: string, self?: string): Item[] {
  const q = query.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const fit = items.filter((i) => {
    if (i.id === self || i.archivedAt || !i.title.trim()) return false;
    const title = i.title.toLowerCase();
    return words.every((w) => title.includes(w) || i.short === w);
  });
  const first = fit.filter((i) => i.title.toLowerCase().startsWith(q));
  return [...first, ...fit.filter((i) => !first.includes(i))].slice(0, SHOWN);
}

/** The markdown link to `card` on `canvas`, with its title as the link's text. */
export function cardRef(canvas: string, card: Pick<Item, 'id' | 'short' | 'title'>): string {
  // brackets in the title would end the link's text early
  const title = card.title.replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim();
  return `[${title}](${cardPath(canvas, card)})`;
}

/**
 * What picking a card types over the `/` search (from its slash to the cursor): its link and a
 * space, or none where a space follows already, which the cursor then steps over (`skip`).
 */
export function cardRefWord(text: string, search: CardSearch, caret: number, link: string): { from: number; to: number; word: string; skip: number } {
  const spaced = /^\s/.test(text.slice(caret));
  return { from: search.start, to: caret, word: `${link}${spaced ? '' : ' '}`, skip: spaced && text[caret] === ' ' ? 1 : 0 };
}

const HREF = /^\/c\/([^/]+)\/card\/([^/?#]+)$/;

/** The canvas and card code an address of a card names; null for any other address. */
export function cardHref(href: string): { canvas: string; code: string } | null {
  const m = HREF.exec(href);
  if (!m) return null;
  try {
    return { canvas: decodeURIComponent(m[1]!), code: decodeURIComponent(m[2]!) };
  } catch {
    return null;
  }
}

/** The card a link names among the canvas's `items`; undefined where it is not among them. */
export const referenced = (items: Item[], href: string): Item | undefined => {
  const at = cardHref(href);
  return at ? named(items, at.code) : undefined;
};

/** The links to cards in a text, each once, in the order they stand: their address and their text. */
export function cardRefsIn(md: string): { href: string; text: string }[] {
  const seen = new Set<string>();
  const out: { href: string; text: string }[] = [];
  for (const m of md.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)) {
    const href = m[2]!;
    if (!cardHref(href) || seen.has(href)) continue;
    seen.add(href);
    out.push({ href, text: m[1]! });
  }
  return out;
}
