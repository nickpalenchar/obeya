import { expect, test } from 'bun:test';
import { anchoredPath, nearestEdge } from './manualLinks';

const target = { x: 100, y: 100, w: 200, h: 100 };

test('snaps to the edge closest to the pointer, outside and inside the target', () => {
  expect(nearestEdge(target, { x: 140, y: 94 })).toMatchObject({ side: 'top', offset: 0.2 });
  expect(nearestEdge(target, { x: 306, y: 130 })).toMatchObject({ side: 'right', offset: 0.3 });
  expect(nearestEdge(target, { x: 240, y: 205 })).toMatchObject({ side: 'bottom', offset: 0.7 });
  expect(nearestEdge(target, { x: 101, y: 160 })).toMatchObject({ side: 'left', offset: 0.6 });
});

test('the route keeps the chosen source and target points when cards move', () => {
  const anchor = { fromSide: 'bottom', toSide: 'right', offset: 0.3 } as const;
  expect(anchoredPath({ x: 0, y: 0, w: 100, h: 50 }, target, anchor).path).toMatch(/^M50,50 .*L300,130$/);
  expect(anchoredPath({ x: 20, y: 10, w: 100, h: 50 }, { ...target, x: 150 }, anchor).path).toMatch(/^M70,60 .*L350,130$/);
});
