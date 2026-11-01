import { expect, test } from 'bun:test';
import { isDevCheckout } from './start';

test('only a checkout named …-dev takes the home and the port of its own', () => {
  expect(isDevCheckout('/Users/nick/harness/obeya-dev')).toBe(true);
  expect(isDevCheckout('/Users/nick/harness/obeya-dev/')).toBe(true);
  expect(isDevCheckout('/Users/nick/harness/obeya')).toBe(false);
  expect(isDevCheckout('/Users/nick/dev/obeya')).toBe(false);
  expect(isDevCheckout('/Users/nick/harness/obeya-develop')).toBe(false);
});
