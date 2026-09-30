export const nativeDraftKey = 'workbench.native-tab-drafts.v1';
export function readNativeDrafts(storage: Pick<Storage, 'getItem'>): Record<string, string> {
  try {
    const value = JSON.parse(storage.getItem(nativeDraftKey) ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const result: Record<string, string> = {};
    for (const [id, text] of Object.entries(value)) if (/^[a-f0-9-]{36}$/.test(id) && typeof text === 'string' && text.length <= 32768) result[id] = text;
    return result;
  } catch { return {}; }
}
