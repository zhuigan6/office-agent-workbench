const key = 'workbench.send-intents.v1';
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
function intents(storage: StorageLike): Record<string, { fingerprint: string; requestId: string }> {
  try { const v=JSON.parse(storage.getItem(key) || '{}');return v&&typeof v==='object'&&!Array.isArray(v)?v:{}; }
  catch { return {}; }
}
export function sendIntent(storage: StorageLike, conversation: string, payload: unknown, uuid:()=>string=()=>crypto.randomUUID()) {
  const all=intents(storage), fingerprint=JSON.stringify(payload), old=all[conversation];
  if(old?.fingerprint===fingerprint&&typeof old.requestId==='string')return old.requestId;
  const requestId=uuid();
  all[conversation]={fingerprint,requestId};
  // Refuse to send if we cannot retain the ID across a page refresh.
  storage.setItem(key,JSON.stringify(all));return requestId;
}
export function acknowledgeIntent(storage: StorageLike, conversation: string, requestId: string) {
  const all=intents(storage);
  if(all[conversation]?.requestId===requestId){delete all[conversation];storage.setItem(key,JSON.stringify(all));}
}
