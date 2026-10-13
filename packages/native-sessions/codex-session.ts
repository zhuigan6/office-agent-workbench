import { EventEmitter } from 'node:events';
import { z } from 'zod';
import { AppError } from '../contracts/index.ts';
import { nativeIdSchema, parseNative, type NativeOwner } from '../contracts/native-session.ts';
import { codexPublicEvents } from './codex-events.ts';
import type { CodexNotification } from './codex-rpc.ts';
import { NativeSessionStore } from './store.ts';

interface Connection {
  request(method: string, params: unknown): Promise<unknown>;
  on(event: string, listener: (...args: any[]) => void): unknown;
  off(event: string, listener: (...args: any[]) => void): unknown;
}
const resumeSchema = z.object({ thread: z.object({ id: nativeIdSchema }).passthrough(), cwd: z.string().min(1) }).passthrough();
const queueSchema = z.object({ queuedSubmission: z.object({ id: nativeIdSchema, clientUserMessageId: nativeIdSchema }).passthrough() }).passthrough();

/** One explicitly linked server session. Never forks, launches another owner or steals an expired lease. */
export class CodexLinkedSession extends EventEmitter {
  private attached = false;
  private failed = false;
  private sending = false;
  private sequence = 0;
  private buffered: CodexNotification[] = [];
  private bufferedBytes = 0;
  private completedTurns = new Map<string,'completed'|'interrupted'>();
  private messageTurns = new Map<string, string>();
  private readonly source;
  private readonly onNotification = (notification: CodexNotification) => {
    if (this.failed) return;
    if (!this.attached) {
      if (!['turn/started', 'turn/completed', 'item/started', 'item/completed'].includes(notification.method)) return;
      if ((notification.params as any)?.threadId !== this.source.vendorSessionId) return;
      this.bufferedBytes += Buffer.byteLength(JSON.stringify(notification));
      if (this.buffered.length >= 32 || this.bufferedBytes > 1024 * 1024) { this.fence(); return; }
      this.buffered.push(notification); return;
    }
    try {
      const events = codexPublicEvents(this.source.vendorSessionId, notification);
      for (const event of events) {
        const journal = this.store.appendEvent(this.linkId, this.principal, this.owner, event);
        this.emit('publicEvent', journal);
        if (event.kind === 'turn.completed' && [...this.messageTurns.values()].includes(event.turnId)) {
          const status=(notification.params as any)?.turn?.status;
          this.completedTurns.set(event.turnId,['failed','interrupted'].includes(status)?'interrupted':'completed');
        }
      }
      const params = notification.params as any;
      if (params?.threadId === this.source.vendorSessionId && notification.method === 'item/completed' && params.item?.type === 'userMessage' &&
          typeof params.item.clientId === 'string' && typeof params.turnId === 'string') {
        this.messageTurns.set(params.item.clientId, params.turnId);
      }
      this.completeKnownMessages();
    } catch { this.fence(); }
  };
  private readonly onDisconnected = () => this.fence();

  constructor(private store: NativeSessionStore, private rpc: Connection, private linkId: string,
    private principal: string, private owner: NativeOwner) {
    super();
    const link = store.get(linkId, principal);
    if (link.vendor !== 'codex') throw new AppError('NATIVE_SOURCE_MISMATCH', 'Codex transport requires an explicit Codex link.', 409);
    this.source = { vendor: 'codex' as const, vendorSessionId: link.vendorSessionId };
  }

  async resume() {
    if (this.attached || this.failed) throw new AppError('NATIVE_STATE_CONFLICT', 'Native attachment cannot be repeated or silently replaced.', 409);
    this.store.heartbeat(this.linkId, this.principal, this.owner, 60_000);
    this.rpc.on('notification', this.onNotification); this.rpc.on('disconnected', this.onDisconnected);
    let result;
    try { result = parseNative(resumeSchema, await this.rpc.request('thread/resume', { threadId: this.source.vendorSessionId })); }
    catch (error) { this.fence(); throw error; }
    if (this.failed) throw new AppError('NATIVE_OWNER_UNCERTAIN', 'Native connection changed during attachment.', 409);
    this.verifyIdentity(result);
    this.attached = true;
    const buffered = this.buffered; this.buffered = []; this.bufferedBytes = 0;
    for (const notification of buffered) this.onNotification(notification);
    if (this.failed) throw new AppError('NATIVE_OWNER_UNCERTAIN', 'Native attachment events require reconciliation.', 409);
    return { sessionId: result.thread.id, attached: true };
  }

  /** Only the trusted transport owner passes its own thread/start acknowledgement here. */
  attachCreated(acknowledgement: unknown) {
    if (this.attached || this.failed) throw new AppError('NATIVE_STATE_CONFLICT', 'Native attachment cannot be silently replaced.', 409);
    this.store.heartbeat(this.linkId, this.principal, this.owner, 60_000);
    const result = parseNative(resumeSchema, acknowledgement);
    this.verifyIdentity(result);
    this.attached = true;
    this.rpc.on('notification', this.onNotification); this.rpc.on('disconnected', this.onDisconnected);
    return { sessionId: result.thread.id, attached: true };
  }

  private verifyIdentity(result: z.infer<typeof resumeSchema>) {
    const link = this.store.get(this.linkId, this.principal);
    const normalize = (cwd: string) => process.platform === 'win32' ? cwd.replaceAll('/', '\\').replace(/\\+$/, '').toLowerCase() : cwd.replace(/\/+$/, '');
    if (result.thread.id !== this.source.vendorSessionId || normalize(result.cwd) !== normalize(link.workingDirectory)) {
      this.fence(); throw new AppError('NATIVE_SOURCE_MISMATCH', 'Native identity or working directory differs; no new link or fork was substituted.', 409);
    }
  }

  heartbeat() { this.assertAttached(); return this.store.heartbeat(this.linkId, this.principal, this.owner, 60_000); }

  async send(messageId: string, text: string) {
    this.assertAttached();
    let existing;
    try { existing = this.store.message(this.linkId, this.principal, messageId); }
    catch (error) { if (!(error instanceof AppError && error.code === 'NATIVE_NOT_FOUND')) throw error; }
    if (existing && existing.state !== 'queued') return this.store.enqueue(this.linkId, this.principal, { messageId, text });
    if (this.sending || this.store.get(this.linkId, this.principal).activeTurnId || this.store.hasPending(this.linkId, this.principal, ['accepted', 'unknown']))
      throw new AppError('NATIVE_TURN_CONFLICT', 'An active or uncertain native turn must complete before another send.', 409);
    const message = this.store.enqueue(this.linkId, this.principal, { messageId, text });
    if (message.state !== 'queued') return message;
    if (this.sending) throw new AppError('NATIVE_TURN_CONFLICT', 'A native dispatch is already being submitted.', 409);
    this.sending = true;
    try {
      this.store.beginDispatch(this.linkId, this.principal, this.owner, this.source, messageId);
      const result = parseNative(queueSchema, await this.rpc.request('thread/queue/add', {
        threadId: this.source.vendorSessionId, clientUserMessageId: messageId, input: [{ type: 'text', text }],
      }));
      if (result.queuedSubmission.clientUserMessageId !== messageId) throw new AppError('NATIVE_SOURCE_MISMATCH', 'Native queue acknowledged a different user message.', 409);
      this.store.recordOutcome(this.linkId, this.principal, this.owner, this.source, messageId, 'accepted', result.queuedSubmission.id);
      this.completeKnownMessages();
      return this.store.message(this.linkId, this.principal, messageId);
    } catch (error) {
      // A protocol failure after dispatch is not permission to retry or pick another session.
      if (this.store.message(this.linkId, this.principal, messageId).state === 'unknown') this.fence();
      throw error;
    } finally { this.sending = false; }
  }

  private completeKnownMessages() {
    for (const [messageId, turn] of this.messageTurns) {
      if (!this.completedTurns.has(turn)) continue;
      let message;
      try { message = this.store.message(this.linkId, this.principal, messageId); }
      catch (error) { if (error instanceof AppError && error.code === 'NATIVE_NOT_FOUND') { this.messageTurns.delete(messageId); continue; } throw error; }
      if(['completed','interrupted','cancelled'].includes(message.state)){this.messageTurns.delete(messageId);this.completedTurns.delete(turn);continue;}
      if (message.state === 'accepted' && message.vendorRequestId) {
        this.store.recordOutcome(this.linkId, this.principal, this.owner, this.source, messageId, this.completedTurns.get(turn)!, message.vendorRequestId);
        this.messageTurns.delete(messageId); this.completedTurns.delete(turn);
      }
    }
    if (this.messageTurns.size > 100 || this.completedTurns.size > 100) throw new AppError('NATIVE_RPC_LIMIT', 'Native correlation requires reconciliation.', 409);
  }

  private assertAttached() {
    if (!this.attached || this.failed) throw new AppError('NATIVE_OWNER_UNCERTAIN', 'Native session is not attached to a verified execution owner.', 409);
  }

  private fence() {
    if (this.failed) return;
    this.failed = true;
    this.buffered = []; this.bufferedBytes = 0;
    try {
      this.store.appendEvent(this.linkId, this.principal, this.owner, { ...this.source,
        vendorEventId: `owner-uncertain-${this.owner.ownerEpoch}-${++this.sequence}`, kind: 'owner.status', status: 'uncertain' });
    } catch { /* An expired or replaced owner is already fenced by persistent storage. */ }
    this.rpc.off('notification', this.onNotification); this.rpc.off('disconnected', this.onDisconnected);
    this.emit('fenced');
  }

  disconnect() { this.fence(); }
}
