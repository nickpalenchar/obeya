/** The fork's extensions are registered here. Core imports only this registry. */
import type { ReactNode } from 'react';
import type { ZodType } from 'zod';
import type { Item } from '../core/types';
import type { Language } from '../core/locale';

export interface Extension {
  /** Routes go through the same host and access checks as core routes. */
  routes?: Record<string, Partial<Record<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', (request: Request) => Response | Promise<Response>>>>;
  event?: (event: { type: 'landed' | 'workerStarted'; canvas: string; card: string }) => void;
  slots?: {
    topBar?: () => ReactNode;
    cardActions?: (item: Item) => ReactNode;
    detail?: (item: Item) => ReactNode;
  };
  strings?: Record<Language, Record<string, unknown>>;
  settings?: Record<string, ZodType>;
}

/** Add an extension here; no runtime discovery or configuration is required. */
export const extensions: readonly Extension[] = [];

/** Files that call the registry, for Lander's outgoing-diff check. */
export const SEAM_FILES = [
  'src/extensions/index.ts',
  'src/adapters/schema.ts',
  'src/adapters/index.ts',
  'src/server/server.ts',
  'src/server/workers.ts',
  'src/ui/App.tsx',
  'src/ui/detail.tsx',
  'src/ui/strings.ts',
] as const;
