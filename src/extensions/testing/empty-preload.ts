// The smoke test must keep exercising an empty registry after real extensions are added.
import { mock } from 'bun:test';
mock.module(new URL('../index.ts', import.meta.url).pathname, () => ({ extensions: [] }));
