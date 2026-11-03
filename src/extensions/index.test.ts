import { expect, test } from 'bun:test';
import { checkShared } from '../adapters/schema';
import { extensions, SEAM_FILES } from './index';

test('without extensions repository settings retain their existing validation', () => {
  expect(extensions).toEqual([]);
  expect(checkShared({ checks: ['bun test'], typo: true })).toEqual({
    settings: { checks: ['bun test'] },
    problems: ['typo: no such field'],
  });
  expect(SEAM_FILES).toContain('src/server/server.ts');
});
