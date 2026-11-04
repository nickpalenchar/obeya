// What a handover may bring; pure, so the page can import it as well as the server and the demo skill.

/**
 * What a handover may bring: `video` (a narrated demo), `html` (an HTML artifact, screenshots
 * among them) and `schema` (the schema-change page of a change to persisted data models).
 */
export const HANDOVER_ARTIFACTS = ['video', 'html', 'schema'] as const;
export type HandoverArtifact = (typeof HANDOVER_ARTIFACTS)[number];

/** A list of artifacts that leaves a handover a demo: it holds `video` or `html`. */
export const allowsDemo = (a: readonly HandoverArtifact[]) => a.includes('video') || a.includes('html');
