import { AppError } from '../contracts/index.ts';
import { Store, digest } from './store.ts';

type Receipt = { turnId: string; messageId: string };

// Persist acceptance, not a second copy of chat history. Ambiguous dispatches
// must never be automatically replayed after a timeout or process restart.
export class MessageDispatcher {
  private active = new Set<string>();
  private completedTurns = new Set<string>();
  constructor(private store: Store) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS message_requests (
      conversation TEXT NOT NULL, request TEXT NOT NULL, hash TEXT NOT NULL,
      state TEXT NOT NULL, receipt TEXT, PRIMARY KEY(conversation, request));
      UPDATE message_requests SET state='unknown' WHERE state='dispatching';`);
  }
  get busy() { return this.active.size > 0; }
  completed(conversation:string,turn?:string){
    if(!turn){this.store.turn(conversation,null);return;}
    this.completedTurns.add(`${conversation}:${turn}`);
    if(this.completedTurns.size>512)this.completedTurns.delete(this.completedTurns.values().next().value!);
    this.store.db.prepare('UPDATE conversations SET turn=NULL WHERE id=? AND turn=?').run(conversation,turn);
  }
  async send(conversation: string, request: string, payload: unknown,
    prepare: () => Promise<() => Promise<Receipt>>): Promise<Receipt> {
    if (typeof request !== 'string' || !/^[\w-]{8,128}$/.test(request)) throw new AppError('INVALID_REQUEST_ID', 'A stable message request ID is required.');
    const hash = digest(payload);
    const old = this.store.db.prepare('SELECT * FROM message_requests WHERE conversation=? AND request=?')
      .get(conversation, request) as { hash: string; state: string; receipt: string } | undefined;
    if (old) {
      if (old.hash !== hash) throw new AppError('ID_REUSED', 'Message request ID belongs to different content.', 409);
      if (old.state === 'accepted') return JSON.parse(old.receipt);
      throw new AppError(old.state === 'unknown' ? 'SEND_UNKNOWN' : 'SEND_PENDING',
        'Message acceptance is pending or uncertain. Inspect chat history before sending again.', 409);
    }
    if (this.active.has(conversation)) throw new AppError('CONVERSATION_BUSY', 'Another window is submitting to this task.', 409);
    this.active.add(conversation);
    let dispatched = false;
    try {
      const execute = await prepare();
      this.store.db.prepare('INSERT INTO message_requests VALUES(?,?,?,?,NULL)')
        .run(conversation, request, hash, 'dispatching');
      dispatched = true;
      const receipt = await execute();
      if (!receipt.turnId || !receipt.messageId) throw new Error('Missing upstream acceptance receipt.');
      this.store.db.prepare("UPDATE message_requests SET state='accepted',receipt=? WHERE conversation=? AND request=?")
        .run(JSON.stringify(receipt), conversation, request);
      if(!this.completedTurns.has(`${conversation}:${receipt.turnId}`))this.store.turn(conversation, receipt.turnId);
      return receipt;
    } catch (error) {
      if (dispatched) {
        this.store.db.prepare("UPDATE message_requests SET state='unknown' WHERE conversation=? AND request=?")
          .run(conversation, request);
        throw new AppError('SEND_UNKNOWN', 'Delivery could not be confirmed. Inspect chat history; this request will not be resent automatically.', 409);
      }
      throw error;
    } finally { this.active.delete(conversation); }
  }
}
