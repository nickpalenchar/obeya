// Merging a proposal with another card: „Zusammenführen mit …“ and its picker, and the merged card
// beside the two it came from, to approve or separate (design: Merging a proposal with a card).

import { useEffect, useMemo, useRef, useState } from 'react';
import { type CardAction, type Item, merging, mergeableWith } from '../core/types';
import { Inline, plain } from './markdown';
import { Body } from './message';
import { MergeMark } from './parts';
import { Shots } from './shots';
import { stateLabel, t } from './strings';

type Act = (a: CardAction, done: { close: true; ack: string } | { close: false }) => Promise<void>;

/** How many cards the picker lists before a search narrows them. */
const SHOWN = 30;

/** The cards a proposal can be merged with, matching `query`, the newest first. */
export function mergeCandidates(p: Item, all: Item[], query: string): Item[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text = (i: Item) => `${i.title}\n${i.body}`.toLowerCase();
  return all
    .filter((i) => mergeableWith(p, i) && words.every((w) => text(i).includes(w)))
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

/** „Zusammenführen mit …“ on a proposal: opens the picker of the cards it can be merged with. */
export function MergeButton({ item, all, act }: { item: Item; all: Item[]; act: Act }) {
  const [open, setOpen] = useState(false);
  if (item.proposal?.idea || item.snoozed || !all.some((i) => mergeableWith(item, i))) return null;
  return (
    <>
      <button className="btn" title={t.merge.buttonHint} onClick={() => setOpen(true)}>
        <MergeMark size={13} /> {t.merge.button}
      </button>
      {open && <MergePicker item={item} all={all} onClose={() => setOpen(false)} onPick={(other) => void act({ action: 'merge', with: other.id }, { close: false }).then(() => setOpen(false))} />}
    </>
  );
}

/** The cards a proposal can be merged with, the newest first, with a search over their titles and texts. */
function MergePicker({ item, all, onClose, onPick }: { item: Item; all: Item[]; onClose: () => void; onPick: (other: Item) => void }) {
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const found = useMemo(() => mergeCandidates(item, all, query).slice(0, SHOWN), [item, all, query]);
  useEffect(() => field.current?.focus(), []);
  useEffect(() => setAt(0), [query]);
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setAt((n) => Math.max(0, Math.min(found.length - 1, n + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Enter' && found[at]) {
      e.preventDefault();
      onPick(found[at]!);
    }
  };
  return (
    <div id="merge-pick" onClick={onClose}>
      <div className="box" role="dialog" aria-modal="true" aria-label={t.merge.pickTitle(plain(item.title))} onClick={(e) => e.stopPropagation()} onKeyDown={key}>
        <button className="close" title={t.merge.cancel} onClick={onClose}>
          ✕
        </button>
        <h2>{t.merge.pickTitle(plain(item.title))}</h2>
        <input ref={field} className="merge-search" type="search" placeholder={t.merge.search} value={query} onChange={(e) => setQuery(e.target.value)} />
        <p className="hint">{t.merge.hint}</p>
        <ul className="merge-list">
          {found.map((i, n) => (
            <li key={i.id}>
              <button className={n === at ? 'merge-row on' : 'merge-row'} onPointerEnter={() => setAt(n)} onClick={() => onPick(i)}>
                <span className={`merge-dot s-${i.state}`} />
                <span className="merge-row-text">
                  <span className="merge-row-title">
                    <Inline md={i.title} />
                  </span>
                  <span className="merge-row-body">{plain(i.body).split('\n')[0]}</span>
                </span>
                <span className="merge-row-kind">{i.state === 'proposal' ? t.merge.proposal : t.merge.planned}</span>
              </button>
            </li>
          ))}
        </ul>
        {!found.length && <p className="hint">{query.trim() ? t.merge.noMatch : t.merge.none}</p>}
      </div>
    </div>
  );
}

/**
 * A proposal merged with another card, in its panel: the two cards side by side on top, the merged
 * card under them, centred, with the spinner while an agent writes it; then „Zusammenführung
 * übernehmen“ and „Trennen“.
 */
export function MergeView({ item, partner, act }: { item: Item; partner?: Item; act: Act }) {
  const m = item.proposal!.merge!;
  const busy = merging(item);
  const side = (i: Item | undefined, kind: string) => (
    <div className="merge-side">
      <div className="merge-side-kind">{kind}</div>
      {i ? (
        <>
          <h3>
            <Inline md={i.title} />
          </h3>
          <Body md={i.body} />
          <Shots ids={i.images} />
        </>
      ) : (
        <p className="hint">{t.merge.gone}</p>
      )}
    </div>
  );
  return (
    <div className="merge-view">
      <div className="merge-sides">
        {side(item, t.merge.proposal)}
        <div className="merge-sides-glue">
          <span className="merge-knot">{busy ? <span className="spinner" /> : <MergeMark />}</span>
        </div>
        {side(partner, partner?.state === 'proposal' ? t.merge.proposal : partner ? stateLabel(partner) : '')}
      </div>
      <div className="merge-arrow" aria-hidden />
      <div className={busy ? 'merge-result busy' : 'merge-result'}>
        <div className="merge-side-kind">{t.merge.result}</div>
        {busy ? (
          <p className="merge-wait">
            <span className="spinner" /> {t.merge.merging}
          </p>
        ) : m.failed !== undefined ? (
          <p className="p-error">{m.failed}</p>
        ) : (
          <>
            <h3>
              <Inline md={m.title ?? ''} />
            </h3>
            <Body md={m.task ?? ''} />
          </>
        )}
      </div>
      {m.task !== undefined && partner && <p className="hint merge-intro">{t.merge.intro(plain(partner.title))}</p>}
      <div className="actions merge-actions">
        {m.task !== undefined && partner && (
          <button className="btn primary" onClick={() => act({ action: 'approveMerge' }, { close: true, ack: t.merge.approved })}>
            <MergeMark size={13} /> {t.merge.approve}
          </button>
        )}
        {m.failed !== undefined && partner && (
          <button className="btn primary" onClick={() => act({ action: 'merge', with: partner.id }, { close: false })}>
            {t.merge.retry}
          </button>
        )}
        <button className="btn" title={t.merge.separateHint} onClick={() => act({ action: 'separate' }, { close: false })}>
          {t.merge.separate}
        </button>
      </div>
    </div>
  );
}
