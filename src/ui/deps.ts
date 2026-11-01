// What a card in the queue waits for, and what waits for a card, over every step: shown while the
// pointer is on a card. A workstream not delivered yet also waits for the open workstreams it builds
// on, as the Koordinator read them from the plan doc, started or not; a card snoozed until another
// card gets somewhere waits for that card.

import type { Bounds } from '../core/layout';
import { finished, type Item } from '../core/types';

export interface Deps {
  /** The cards the hovered one waits for, directly or through others. */
  before: Set<string>;
  /** The cards waiting for the hovered one, directly or through others. */
  after: Set<string>;
  /** Each wait on the way, from the card waited for to the card waiting. */
  edges: [from: string, to: string][];
}

const queued = (i: Item) => (i.queue && 'behind' in i.queue ? i.queue.behind : []);
const snoozedOn = (i: Item) => (i.snoozed?.on ? [i.snoozed.on.card] : []);

/** The waits around `id` among `items`, both ways; undefined when there are none or `id` is gone
 *  (a card archived under the pointer stays hovered). */
export function depsOf(id: string, items: Item[]): Deps | undefined {
  const byId = new Map(items.map((i) => [i.id, i]));
  if (!byId.has(id)) return undefined;
  const open = (x: string | undefined) => !!x && byId.has(x) && !finished(byId.get(x)!.state);
  const behind = (i: Item) => [...new Set([...queued(i), ...snoozedOn(i), ...(open(i.id) ? (i.manualDependsOn ?? []).filter(open) : []), ...(open(i.id) ? (i.buildsOn ?? []).filter(open) : [])])];
  const waiters = new Map<string, string[]>();
  for (const i of items) for (const b of behind(i)) if (byId.has(b)) waiters.set(b, [...(waiters.get(b) ?? []), i.id]);
  const edges = new Map<string, [string, string]>();
  const walk = (next: (x: string) => string[], edge: (x: string, y: string) => [string, string]) => {
    const seen = new Set<string>();
    const todo = [id];
    while (todo.length) {
      const x = todo.pop()!;
      for (const y of next(x)) {
        const e = edge(x, y);
        edges.set(e.join(' '), e);
        if (y === id || seen.has(y)) continue;
        seen.add(y);
        todo.push(y);
      }
    }
    return seen;
  };
  const before = walk((x) => behind(byId.get(x)!).filter((b) => byId.has(b)), (x, y) => [y, x]);
  const after = walk((x) => waiters.get(x) ?? [], (x, y) => [x, y]);
  if (!before.size && !after.size) return undefined;
  return { before, after, edges: [...edges.values()] };
}


/** Dots within 18 screen pixels, or whose card edge is within 6 screen pixels. */
export function visibleDotSides(b: Bounds, pointer: { x: number; y: number }, scale: number): string[] {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const x = clamp(pointer.x, b.x, b.x + b.w);
  const y = clamp(pointer.y, b.y, b.y + b.h);
  const edges = [
    { side: 'top', dot: [b.x + b.w / 2, b.y], edge: [x, b.y] },
    { side: 'right', dot: [b.x + b.w, b.y + b.h / 2], edge: [b.x + b.w, y] },
    { side: 'bottom', dot: [b.x + b.w / 2, b.y + b.h], edge: [x, b.y + b.h] },
    { side: 'left', dot: [b.x, b.y + b.h / 2], edge: [b.x, y] },
  ];
  return edges.filter(({ dot, edge }) =>
    Math.hypot(pointer.x - dot[0]!, pointer.y - dot[1]!) * scale <= 18 ||
    Math.hypot(pointer.x - edge[0]!, pointer.y - edge[1]!) * scale <= 6,
  ).map(({ side }) => side);
}

/** Unfinished prerequisites explicitly connected by the owner. */
export function manualPrerequisites(item: Item, items: Item[]): Item[] {
  return (item.manualDependsOn ?? []).flatMap((id) => {
    const prerequisite = items.find((i) => i.id === id);
    return prerequisite && !prerequisite.archivedAt && !finished(prerequisite.state) ? [prerequisite] : [];
  });
}
