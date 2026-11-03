// The smoke test must keep exercising an empty registry after real extensions are added.
import { mock } from 'bun:test';
import { fileURLToPath } from 'node:url';
mock.module(fileURLToPath(new URL('../index.ts', import.meta.url)), () => ({ extensions: [] }));
