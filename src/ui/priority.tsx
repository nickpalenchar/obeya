import { useRef, useState } from 'react';
import { type Item, type Priority, PRIORITIES } from '../core/types';
import { api } from './api';
import { useMenuClose } from './queue';
import { t } from './strings';

/** A flag, in the colour of the priority it marks. */
const Flag = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M5 21V4h11l-1.5 4L16 12H7v9z" />
  </svg>
);

/** A card's priority on its face: a flag and its name, in its colour. */
export const PriorityMark = ({ priority }: { priority: Priority }) => (
  <span className={`prio prio-${priority}`}>
    <Flag />
    {t.priority.names[priority]}
  </span>
);

/**
 * The priority on the unfolded card: its mark, or „Priorität setzen“ while it has none; a click
 * lists the priorities, the highest first, and „Keine“ takes it off. It takes effect at once.
 */
export function PriorityPick({ item }: { item: Item }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useMenuClose(open, box, () => setOpen(false), true);
  const pick = (priority: Priority | null) => {
    setOpen(false);
    if (priority !== (item.priority ?? null)) api.patch(item.id, { priority }).catch(console.error);
  };
  return (
    <span className="prio-pick" ref={box}>
      <button className={item.priority ? 'prio-btn set' : 'prio-btn'} title={t.priority.label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {item.priority ? (
          <PriorityMark priority={item.priority} />
        ) : (
          <span className="prio prio-none">
            <Flag />
            {t.priority.set}
          </span>
        )}
      </button>
      {open && (
        <div className="prio-menu" role="menu">
          {[...PRIORITIES].reverse().map((p) => (
            <button key={p} role="menuitemradio" aria-checked={item.priority === p} className={item.priority === p ? 'on' : ''} onClick={() => pick(p)}>
              <PriorityMark priority={p} />
            </button>
          ))}
          <button role="menuitemradio" aria-checked={!item.priority} className={item.priority ? 'none' : 'none on'} onClick={() => pick(null)}>
            {t.priority.none}
          </button>
        </div>
      )}
    </span>
  );
}
