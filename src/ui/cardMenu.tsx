// The menu `/` opens in a card's task field (`cardRefs.ts`): the canvas's cards whose titles fit
// what follows the slash, under the field, each as the smart link it will become. The arrow keys
// mark, Enter, Tab or a click picks, Escape closes it and leaves the card open. Picking types the
// card's link over the search, as if by hand (⌘Z takes it back). Under the field the cards the text
// links to stand as smart links, since the field itself shows the links' markdown.

import { type KeyboardEvent, type RefObject, useContext, useEffect, useRef, useState } from 'react';
import type { Item } from '../core/types';
import { canvasOf } from './api';
import { SmartLink } from './cardLink';
import { type CardSearch, cardRef, cardRefsIn, cardRefWord, cardSearchAt, knowsCardRefs, matchingCards, usedCardRefs } from './cardRefs';
import { cardPath } from './address';
import { typeInto } from './draft';
import { Cards } from './message';
import { t } from './strings';

/** The card search of the task field `field` of card `self`, whose text is `text`: its handlers for the field, the menu (in the field's frame) and what stands under the field. */
export function useCardSearch(field: RefObject<HTMLTextAreaElement | null>, self: Item, text: string) {
  const { items } = useContext(Cards);
  const [focused, setFocused] = useState(false);
  // the search at the cursor, the card marked in the menu, and where Escape closed the menu
  const [search, setSearch] = useState<CardSearch | null>(null);
  const [marked, setMarked] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const atCursor = () => {
    const el = field.current;
    const at = el && el.selectionStart === el.selectionEnd ? cardSearchAt(el.value, el.selectionStart) : null;
    setSearch((s) => (s?.start === at?.start && s?.query === at?.query ? s : at));
    if (!at) setDismissed(null);
  };
  useEffect(atCursor, [text]);
  useEffect(() => setMarked(0), [search?.query]);
  const menu = focused && search && dismissed !== search.start ? matchingCards(items, search.query, self.id) : [];
  const pick = (card: Item) => {
    const el = field.current;
    if (!el || !search) return;
    const { from, to, word, skip } = cardRefWord(el.value, search, el.selectionStart, cardRef(canvasOf(card.id), card));
    el.focus();
    el.setSelectionRange(from, to);
    typeInto(el, word);
    if (skip) el.setSelectionRange(el.selectionStart + skip, el.selectionStart + skip);
    usedCardRefs();
  };
  const props = {
    // while the menu is open, Escape closes it, not the card
    'data-esc': menu.length > 0 || undefined,
    onSelect: atCursor,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => {
      const n = menu.length;
      if (!n || !search || e.nativeEvent.isComposing) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissed(search.start);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setMarked((m) => (m + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
      } else if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        pick(menu[Math.min(marked, n - 1)]!);
      }
    },
  };
  const refs = cardRefsIn(text);
  // the menu over what follows the field, the cards linked under it
  const menuShown = menu.length > 0 && <CardMenu cards={menu} marked={marked} onPick={pick} />;
  const under = (
    <>
      {refs.length > 0 && (
        <div className="card-refs" aria-label={t.cardRefs.linked}>
          {refs.map((r) => (
            <SmartLink key={r.href} href={r.href} text={r.text} />
          ))}
        </div>
      )}
      {focused && !menu.length && !knowsCardRefs() && <p className="c-listener card-refs-hint">{t.cardRefs.hint}</p>}
    </>
  );
  return { props, menu: menuShown, under };
}

/** The cards that fit the search, the marked one picked with Enter or Tab, another with the arrow keys or a click. */
function CardMenu({ cards, marked, onPick }: { cards: Item[]; marked: number; onPick: (card: Item) => void }) {
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    list.current?.children[marked]?.scrollIntoView({ block: 'nearest' });
  }, [marked, cards]);
  return (
    <div className="skill-menu card-menu" role="listbox" aria-label={t.cardRefs.menu}>
      <ul ref={list}>
        {cards.map((c, i) => (
          <li key={c.id} role="option" aria-selected={i === marked} className={i === marked ? 'on' : undefined} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(c)}>
            {/* a click on it picks the card rather than opening it */}
            <span className="cm-pill">
              <SmartLink href={cardPath(canvasOf(c.id), c)} text={c.title} />
            </span>
            {c.short && <span className="cm-code">{c.short}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
