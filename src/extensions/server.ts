/** Server implementations of the extensions enabled in the registry. */
import type { ZodType } from 'zod';
import { enabled } from './index';

export type Settings = Record<string, unknown>;
export interface ServerExtension {
  /** Routes use the core's access checks; lookup returns the active repository's extension settings. */
  routes?: Record<string, Partial<Record<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', (request: Request, context: { settings: (canvas: string, repo: string) => Settings | undefined }) => Response | Promise<Response>>>>;
  event?: (event: { type: 'landed' | 'workerStarted'; canvas: string; card: string; settings: Settings }) => void | Promise<void>;
  settings?: Record<string, ZodType>;
}

// Add an enabled extension's server implementation here, without importing its browser module.
const implementations: Record<string, ServerExtension> = {};
export const serverExtensions: readonly ServerExtension[] = enabled.flatMap((name) => implementations[name] ? [implementations[name]!] : []);

/** Only registered extension fields, never the repository's core configuration. */
export function extensionSettings(settings: object): Settings {
  return Object.fromEntries(serverExtensions.flatMap((e) => Object.keys(e.settings ?? {})).map((key) => [key, (settings as Settings)[key]]).filter(([, value]) => value !== undefined));
}
