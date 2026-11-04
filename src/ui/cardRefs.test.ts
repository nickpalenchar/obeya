import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Item } from '../core/types';
import { setCanvas } from './api';
import { smartLink } from './cardLink';
import { cardHref, cardRef, cardRefsIn, cardRefWord, cardSearchAt, matchingCards } from './cardRefs';
import { CardRefs, Inline } from './markdown';
import { Cards } from './message';

const card = (id: string, title: string, more: Partial<Item> = {}) => ({ id, short: id.slice(0, 4), title, state: 'planned', ...more }) as Item;

test('a slash at the start of the text or of a word searches cards, with the words after it on its line', () => {
  expect(cardSearchAt('/', 1)).toEqual({ start: 0, query: '' });
  expect(cardSearchAt('builds on /login bu', 19)).toEqual({ start: 10, query: 'login bu' });
  expect(cardSearchAt('first line\n/dem', 15)).toEqual({ start: 11, query: 'dem' });
});

test('a path, a slash inside a word, a slash before a space or on an earlier line searches nothing', () => {
  expect(cardSearchAt('see /src/ui', 11)).toBeNull();
  expect(cardSearchAt('and/or', 6)).toBeNull();
  expect(cardSearchAt('this / that', 11)).toBeNull();
  expect(cardSearchAt('/login\nnext', 11)).toBeNull();
  // a link put in before is no search
  expect(cardSearchAt('[Login](/c/x/card/ab12) ', 24)).toBeNull();
});

test('every word of the search is in the title or is the short code; titles that start with it first', () => {
  const items = [card('aaaa1', 'Fix the login page'), card('bbbb2', 'Login with Google'), card('cccc3', 'Dark mode'), card('dddd4', 'Old login', { archivedAt: '2026-01-01' })];
  expect(matchingCards(items, 'login').map((i) => i.id)).toEqual(['bbbb2', 'aaaa1']);
  expect(matchingCards(items, 'LOGIN page').map((i) => i.id)).toEqual(['aaaa1']);
  expect(matchingCards(items, 'cccc').map((i) => i.id)).toEqual(['cccc3']);
  // not the card itself, nor what is archived
  expect(matchingCards(items, 'login', 'bbbb2').map((i) => i.id)).toEqual(['aaaa1']);
  expect(matchingCards(items, 'nothing')).toEqual([]);
});

test('a card picked is typed over the search as a link to its address, with a space unless one follows', () => {
  const link = cardRef('obeya', card('abcd1234', 'Fix [the] login'));
  expect(link).toBe('[Fix the login](/c/obeya/card/abcd)');
  expect(cardRefWord('see /log', { start: 4, query: 'log' }, 8, link)).toEqual({ from: 4, to: 8, word: `${link} `, skip: 0 });
  expect(cardRefWord('/log and more', { start: 0, query: 'log' }, 4, link)).toEqual({ from: 0, to: 4, word: link, skip: 1 });
});

test('the links to cards in a text, each once; other links are none', () => {
  expect(cardHref('/c/my%20canvas/card/ab12')).toEqual({ canvas: 'my canvas', code: 'ab12' });
  expect(cardHref('https://x.org/c/a/card/b')).toBeNull();
  const md = 'After [Login](/c/o/card/ab12) and [docs](https://x.org), again [Login again](/c/o/card/ab12), then [Dark](/c/o/card/cd34).';
  expect(cardRefsIn(md)).toEqual([
    { href: '/c/o/card/ab12', text: 'Login' },
    { href: '/c/o/card/cd34', text: 'Dark' },
  ]);
});

test('in a shown text a link to a card is a smart link: its state, current title and priority; one not on the canvas keeps its text, muted', () => {
  setCanvas('o');
  const items = [card('ab12xx', 'Login with Google', { state: 'working', priority: 'high' })];
  const md = 'Builds on [Login](/c/o/card/ab12) and [Gone](/c/o/card/zz99).';
  const html = renderToStaticMarkup(
    createElement(Cards.Provider, { value: { items, open: () => {} } }, createElement(CardRefs.Provider, { value: smartLink }, createElement(Inline, { md }))),
  );
  expect(html).toContain('<a class="smart-link s-working" href="/c/o/card/ab12"');
  expect(html).toContain('<span class="sl-title">Login with Google</span>');
  expect(html).toContain('prio prio-high');
  expect(html).toContain('<span class="smart-link gone"><span class="sl-dot"></span><span class="sl-title">Gone</span></span>');
  // without smart links (a plan doc, say) the link is its text, as before
  expect(renderToStaticMarkup(createElement(Inline, { md }))).toBe('Builds on <span>Login</span> and <span>Gone</span>.');
});
