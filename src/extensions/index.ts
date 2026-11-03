/** The one list of enabled fork extensions. Their client and server implementations are loaded
 * separately, so server code never enters the browser bundle. */
export const enabled: readonly string[] = [];

/** Files that call the seam, for Lander's outgoing-diff check. */
export const SEAM_FILES = [
  'src/extensions/index.ts',
  'src/extensions/client.ts',
  'src/extensions/server.ts',
  'src/adapters/index.ts',
  'src/adapters/schema.ts',
  'src/server/config.ts',
  'src/server/server.ts',
  'src/server/workers.ts',
  'src/ui/App.tsx',
  'src/ui/config.tsx',
  'src/ui/detail.tsx',
  'src/ui/strings.ts',
] as const;
