import { expect, test } from 'bun:test';
import { captionsEnabled, rememberCaptions } from './captions';

test('the caption choice starts on and is remembered for later videos', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  expect(captionsEnabled(storage)).toBe(true);
  rememberCaptions(storage, false);
  expect(captionsEnabled(storage)).toBe(false);
  rememberCaptions(storage, true);
  expect(captionsEnabled(storage)).toBe(true);
});

test('unavailable storage leaves captions enabled without breaking playback', () => {
  const storage = { getItem: () => { throw Error('unavailable'); }, setItem: () => { throw Error('unavailable'); } };
  expect(captionsEnabled(storage)).toBe(true);
  expect(() => rememberCaptions(storage, false)).not.toThrow();
});
