// Run in a fresh process: the production registry stays empty in the rest of the suite.
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { extensions, type Extension } from '../index';

const events: { type: string; canvas: string; card: string }[] = [];
(extensions as Extension[]).splice(0);
(extensions as Extension[]).push({
  settings: { example: z.string().optional() },
  strings: { en: { exampleExtension: { label: 'Hello' } }, de: { exampleExtension: { label: 'Hallo' } } },
  routes: { '/api/extension-example': { GET: () => Response.json({ example: true }) } },
  event: (event) => { events.push(event); },
});
const { checkShared } = await import('../../adapters/schema');
const { generic } = await import('../../adapters/generic');
const { withSettings } = await import('../../adapters');
assert.deepEqual(checkShared({ example: 'value' }), { settings: { example: 'value' }, problems: [] });
assert.equal(checkShared({ example: 3 }).problems.length, 1);
assert.equal((withSettings(generic, () => ({ land: 'main', example: 'value' })) as unknown as Record<string, unknown>).example, 'value');
const strings = await import('../../ui/strings');
for (const [language, expected] of [['en', 'Hello'], ['de', 'Hallo']] as const) {
  strings.setLanguage(language, []);
  assert.equal((strings.t as unknown as { exampleExtension: { label: string } }).exampleExtension.label, expected);
}
const { Config, readConfigFile } = await import('../../server/config');
const { Store } = await import('../../server/db');
const configDir = mkdtempSync(join(tmpdir(), 'obeya-extension-config-'));
try {
  const file = join(configDir, 'config.json');
  writeFileSync(file, JSON.stringify([{ repos: [{ path: '/example', settings: { example: 'machine' } }] }]));
  assert.equal((readConfigFile(file)[0]!.repos[0]!.settings as unknown as Record<string, unknown>).example, 'machine');
  const config = new Config({ file, source: 'file', started: [], store: new Store(':memory:'), running: () => [], server: { port: 0, home: configDir, permissionMode: 'auto' } });
  config.takenOver('/example', undefined, { example: 'machine' } as never);
  assert.equal(readConfigFile(file)[0]!.repos[0]!.settings, undefined);
} finally { rmSync(configDir, { recursive: true, force: true }); }
const { serve } = await import('../../server/server');
const { asOwner, artifact } = await import('../../server/testing');
const server = serve([], { transcriber: { transcribe: async () => ({ text: '', doubtful: false }) } }, 0);
try {
  const url = new URL('/api/extension-example', server.url);
  assert.notEqual((await fetch(url)).status, 200);
  assert.deepEqual(await (await asOwner(() => server).fetch(url)).json(), { example: true });
} finally { server.stop(true); }
const fixture = await import('../../server/workers-fixture');
const { git } = await import('../../server/workspaces');
fixture.setup({ ...generic, land: 'main', workspaces: 'clones' });
try {
  const card = fixture.manual();
  await fixture.workers.start(card.id);
  assert.deepEqual(events, [{ type: 'workerStarted', canvas: 'c', card: card.id }]);
  const workspace = fixture.board.row(card.id).workspace!;
  writeFileSync(join(workspace, 'example.txt'), 'example');
  git(workspace, 'add', 'example.txt');
  git(workspace, 'commit', '--quiet', '-m', 'Example');
  await fixture.runtime.last.call('ready_for_review', { summary: 'Example', demo: artifact() });
  await fixture.workers.approve(card.id);
  assert.deepEqual(events.map((e) => e.type), ['workerStarted', 'landed']);
  await fixture.workers.freed();
} finally { rmSync(fixture.dir, { recursive: true, force: true }); }
