import { expect, test } from 'bun:test';

test('a registered extension participates in settings, languages, guarded routes and card events', () => {
  const result = Bun.spawnSync([process.execPath, 'src/extensions/testing/registered.ts'], { stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  expect(result.exitCode).toBe(0);
}, 30_000);
