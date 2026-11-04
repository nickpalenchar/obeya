// A card's labels (`core/labels.ts`): on its face, the priority's flag and compact chips after it;
// on the unfolded card, a picker for each. A label Obeya suggested and the owner has not touched is
// drawn with a purple border, which stays clear of a proposal's violet; any pick makes it theirs.

import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { COMPLEXITIES, type Complexity, type Label, type Labels, LABEL_VALUES, PRIORITIES, type Priority } from '../core/labels';
import type { Item } from '../core/types';
import { api } from './api';
import { useMenuClose } from './queue';
import { t } from './strings';

/** A flag, in the colour of the priority it marks. */
const Flag = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M5 21V4h11l-1.5 4L16 12H7v9z" />
  </svg>
);

/** Five rising bars, as many filled as the complexity's step in the scale. */
const Bars = ({ complexity }: { complexity: Complexity }) => {
  const filled = COMPLEXITIES.indexOf(complexity) + 1;
  return (
    <svg width="11" height="10" viewBox="0 0 11 10" aria-hidden>
      {COMPLEXITIES.map((_, i) => (
        <rect key={i} x={i * 2.25} y={8 - i * 2} width="1.5" height={2 + i * 2} rx=".4" fill="currentColor" opacity={i < filled ? 1 : 0.28} />
      ))}
    </svg>
  );
};

const suggestedOf = (item: Item, label: Label) => !!item.suggested?.includes(label);

/** A card's priority on its face: a flag and its name, in its colour; framed in purple while Obeya suggested it. */
export const PriorityMark = ({ priority, suggested }: { priority: Priority; suggested?: boolean }) => (
  <span className={`prio prio-${priority}${suggested ? ' sugg' : ''}`} title={suggested ? t.labels.suggested : undefined}>
    <Flag />
    {t.priority.names[priority]}
  </span>
);

/** The text of a category, sub-category or complexity, as its chip and its picker show it. */
function chipText(label: Exclude<Label, 'priority'>, v: NonNullable<Labels[typeof label]>) {
  if (label === 'complexity') return String(v);
  return label === 'category' ? t.labels.category.names[v as keyof typeof t.labels.category.names] : t.labels.subcategory.names[v as keyof typeof t.labels.subcategory.names];
}

/** What a chip says on hover: the label's name and, for complexity, its step's description. */
function chipTitle(label: Exclude<Label, 'priority'>, v: NonNullable<Labels[typeof label]>) {
  return label === 'complexity' ? t.labels.complexity.step(v as Complexity) : `${t.labels[label].label}: ${chipText(label, v)}`;
}

/** One label as a compact chip; purple-bordered while Obeya suggested it. */
function Chip({ label, value, suggested }: { label: Exclude<Label, 'priority'>; value: NonNullable<Labels[typeof label]>; suggested?: boolean }) {
  return (
    <span className={`lchip lchip-${label}${suggested ? ' sugg' : ''}`} title={suggested ? `${chipTitle(label, value)}\n${t.labels.suggested}` : chipTitle(label, value)}>
      {label === 'complexity' && <Bars complexity={value as Complexity} />}
      {chipText(label, value)}
    </span>
  );
}

const CHIPPED = ['category', 'subcategory', 'complexity'] as const;

/** Whether a card has any label to show. */
export const hasLabels = (item: Item) => !!item.priority || CHIPPED.some((l) => item[l] !== undefined);

/** A card's labels on its face: its priority's flag, then a chip for each label it has (in a box of class `chips`, where given). */
export function LabelMarks({ item, chips }: { item: Item; chips?: string }) {
  const shown = CHIPPED.filter((l) => item[l] !== undefined).map((l) => <Chip key={l} label={l} value={item[l]!} suggested={suggestedOf(item, l)} />);
  return (
    <>
      {item.priority && <PriorityMark priority={item.priority} suggested={suggestedOf(item, 'priority')} />}
      {chips ? shown.length > 0 && <span className={chips}>{shown}</span> : shown}
    </>
  );
}

/**
 * A label on the unfolded card: its mark, or its name in a frame while it has none; a click lists
 * its values and „Keine“, which takes it off. A pick takes effect at once and makes the label the
 * owner's, the same value as Obeya's suggestion included.
 */
function LabelPick<L extends Label>({ item, label, values, shown, empty, option, optionTitle, open, setOpen }: {
  item: Item;
  label: L;
  values: readonly NonNullable<Labels[L]>[];
  shown: (v: NonNullable<Labels[L]>) => ReactNode;
  empty: ReactNode;
  option: (v: NonNullable<Labels[L]>) => ReactNode;
  optionTitle?: (v: NonNullable<Labels[L]>) => string;
  open: boolean;
  setOpen: (on: boolean) => void;
}) {
  const box = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useMenuClose(open, box, () => setOpen(false), true);
  // a list that would run past the window's right edge (a picker far right, a phone) moves left until it fits
  useLayoutEffect(() => {
    const m = menu.current;
    if (!open || !m) return;
    const over = m.getBoundingClientRect().right - (document.documentElement.clientWidth - 8);
    if (over > 0) m.style.left = `${-over}px`;
  }, [open]);
  const now = item[label] as Labels[L] | undefined;
  const pick = (v: NonNullable<Labels[L]> | null) => {
    setOpen(false);
    api.patch(item.id, { [label]: v }).catch(console.error);
  };
  return (
    <span className="prio-pick" ref={box}>
      <button className={now !== undefined ? 'prio-btn set' : 'prio-btn'} title={label === 'priority' ? t.priority.label : t.labels[label as Exclude<Label, 'priority'>].label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {now !== undefined ? shown(now as NonNullable<Labels[L]>) : empty}
      </button>
      {open && (
        <div ref={menu} className={`prio-menu lmenu-${label}`} role="menu">
          {values.map((v) => (
            <button key={String(v)} role="menuitemradio" aria-checked={now === v} className={now === v ? 'on' : ''} title={optionTitle?.(v)} onClick={() => pick(v)}>
              {option(v)}
            </button>
          ))}
          <button role="menuitemradio" aria-checked={now === undefined} className={now !== undefined ? 'none' : 'none on'} onClick={() => pick(null)}>
            {t.priority.none}
          </button>
        </div>
      )}
    </span>
  );
}

/** The unfolded card's pickers: priority, category, sub-category and complexity, one list open at a time. */
export function LabelPicks({ item }: { item: Item }) {
  const [open, setOpen] = useState<Label>();
  const at = (l: Label) => ({ open: open === l, setOpen: (on: boolean) => setOpen(on ? l : undefined) });
  const empty = (text: string, icon?: ReactNode) => (
    <span className="lchip-none">
      {icon}
      {text}
    </span>
  );
  return (
    <span className="label-picks">
      <LabelPick
        item={item}
        label="priority"
        values={PRIORITIES}
        shown={(p) => <PriorityMark priority={p} suggested={suggestedOf(item, 'priority')} />}
        empty={empty(t.priority.set, <Flag />)}
        option={(p) => <PriorityMark priority={p} />}
        {...at('priority')}
      />
      {CHIPPED.map((l) => (
        <LabelPick
          key={l}
          item={item}
          label={l}
          values={LABEL_VALUES[l]}
          shown={(v) => <Chip label={l} value={v} suggested={suggestedOf(item, l)} />}
          empty={empty(t.labels[l].label, l === 'complexity' ? <Bars complexity={1} /> : undefined)}
          option={(v) =>
            l === 'complexity' ? (
              <span className="lopt">
                <Bars complexity={v as Complexity} />
                <b>{v}</b>
                <span>{t.labels.complexity.descriptions[v as Complexity]}</span>
              </span>
            ) : (
              chipText(l, v)
            )
          }
          optionTitle={l === 'complexity' ? (v) => t.labels.complexity.step(v as Complexity) : undefined}
          {...at(l)}
        />
      ))}
    </span>
  );
}
