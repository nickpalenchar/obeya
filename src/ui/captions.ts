// A preference belongs to this browser, across cards and canvases.
const KEY = 'obeya:captions';

export function captionsEnabled(storage: Pick<Storage, 'getItem'>): boolean {
  try { return storage.getItem(KEY) !== 'off'; } catch { return true; }
}

export function rememberCaptions(storage: Pick<Storage, 'setItem'>, enabled: boolean): void {
  try { storage.setItem(KEY, enabled ? 'on' : 'off'); } catch {}
}
