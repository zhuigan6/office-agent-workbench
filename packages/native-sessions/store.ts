import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { AppError, canonical } from '../contracts/index.ts';
import {
  NATIVE_SESSION_LIMITS, nativeIdSchema, nativeLinkSchema, nativeOwnerSchema, nativeSourceSchema,
  nativeMessageSchema, nativePublicEventSchema, nativeReplaySchema, parseNative, sanitizeNativeData,
  type NativeSessionLink, type NativeLinkInput, type NativeOwner, type NativeSource,
  type NativeOutboundMessage, type NativeJournalEvent,
} from '../contracts/native-session.ts';

const leaseSchema = z.number().int().min(1).max(NATIVE_SESSION_LIMITS.leaseMs);
const epochSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1);

/** Caller owns the database lifecycle. No vendor I/O, transcript parsing, or automatic takeover. */
export class NativeSessionStore {
  constructor(private readonly db: DatabaseSync, private readonly now: () => number = Date.now) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS native_session_links (
        id TEXT PRIMARY KEY, thread TEXT UNIQUE NOT NULL, vendor TEXT NOT NULL,
        session TEXT NOT NULL, body TEXT NOT NULL, UNIQUE(vendor, session));
      CREATE TABLE IF NOT EXISTS native_session_messages (
        link TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(link, id));
      CREATE TABLE IF NOT EXISTS native_session_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, link TEXT NOT NULL, vendor TEXT NOT NULL,
        session TEXT NOT NULL, event_id TEXT NOT NULL, body TEXT NOT NULL,
        UNIQUE(vendor, session, event_id));
      CREATE INDEX IF NOT EXISTS native_session_replay ON native_session_events(link, seq);
    `);
  }

  private transaction<T>(action: () => T): T {
    // Dispatch markers must commit before the caller can perform vendor I/O.
    if (this.db.isTransaction) throw new AppError('NATIVE_TRANSACTION_CONFLICT', 'Native writes require an independent committed transaction.', 409);
    try { this.db.exec('BEGIN IMMEDIATE'); }
    catch { throw new AppError('NATIVE_STORAGE_UNAVAILABLE', 'Native session storage cannot acquire a write transaction.', 503); }
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      if (error instanceof AppError) throw error;
      throw new AppError('NATIVE_STORAGE_ERROR', 'Native session storage write failed.', 503);
    }
  }

  private load(linkId: string, principalId: string): NativeSessionLink {
    parseNative(nativeIdSchema, linkId); parseNative(nativeIdSchema, principalId);
    const row = this.db.prepare('SELECT body FROM native_session_links WHERE id=?').get(linkId);
    if (!row) throw new AppError('NATIVE_NOT_FOUND', 'Native session link not found.', 404);
    const link: NativeSessionLink = JSON.parse(String(row.body));
    if (link.ownerLink.principalId !== principalId) throw new AppError('NATIVE_FORBIDDEN', 'Native session link belongs to another principal.', 403);
    return link;
  }

  private save(link: NativeSessionLink) {
    this.db.prepare('UPDATE native_session_links SET body=? WHERE id=?').run(JSON.stringify(link), link.linkId);
  }

  private source(link: NativeSessionLink, input: NativeSource) {
    const source = parseNative(nativeSourceSchema, input);
    if (source.vendor !== link.vendor || source.vendorSessionId !== link.vendorSessionId)
      throw new AppError('NATIVE_SOURCE_MISMATCH', 'Unexpected native session or fork; create a separate explicit link.', 409);
  }

  private owner(link: NativeSessionLink, input: NativeOwner, requireLive = true) {
    const owner = parseNative(nativeOwnerSchema, input);
    if (!link.owner || owner.ownerId !== link.owner.ownerId || owner.launchId !== link.owner.launchId || owner.ownerEpoch !== link.ownerEpoch)
      throw new AppError('NATIVE_OWNER_CONFLICT', 'Execution owner or epoch does not match.', 409);
    if (requireLive && (link.owner.status !== 'active' || link.owner.leaseExpiresAt <= this.now()))
      throw new AppError('NATIVE_OWNER_UNCERTAIN', 'Owner lease is uncertain; explicit release or handoff is required.', 409);
  }

  link(principalId: string, input: NativeLinkInput): NativeSessionLink {
    const data = parseNative(nativeLinkSchema, input);
    parseNative(nativeIdSchema, principalId);
    if (principalId !== data.ownerLink.principalId) throw new AppError('NATIVE_FORBIDDEN', 'Only the explicit linked principal may create this link.', 403);
    return this.transaction(() => {
      const row = this.db.prepare('SELECT body FROM native_session_links WHERE id=? OR thread=? OR (vendor=? AND session=?)')
        .get(data.linkId, data.threadId, data.vendor, data.vendorSessionId);
      if (row) {
        if (!this.db.prepare('SELECT id FROM native_session_links WHERE id=?').get(data.linkId))
          throw new AppError('NATIVE_LINK_CONFLICT', 'Thread or native session already has an explicit link.', 409);
        const existing = this.load(data.linkId, principalId);
        const { ownerEpoch: _epoch, owner: _owner, activeTurnId: _turn, ...original } = existing;
        if (canonical(original) !== canonical(data)) throw new AppError('NATIVE_LINK_CONFLICT', 'Link identity and capabilities are immutable.', 409);
        return this.get(data.linkId, principalId);
      }
      const link: NativeSessionLink = { ...data, ownerEpoch: 0, owner: null, activeTurnId: null };
      this.db.prepare('INSERT INTO native_session_links VALUES(?,?,?,?,?)').run(data.linkId, data.threadId, data.vendor, data.vendorSessionId, JSON.stringify(link));
      return link;
    });
  }

  get(linkId: string, principalId: string): NativeSessionLink {
    const link = this.load(linkId, principalId);
    if (link.owner && link.owner.leaseExpiresAt <= this.now()) link.owner.status = 'uncertain';
    return link;
  }

  list(principalId: string, input: { after?: number; limit?: number } = {}) {
    parseNative(nativeIdSchema, principalId);
    const { after, limit } = parseNative(nativeReplaySchema, input);
    const rows = this.db.prepare("SELECT rowid,id FROM native_session_links WHERE rowid>? AND json_extract(body,'$.ownerLink.principalId')=? ORDER BY rowid LIMIT ?")
      .all(after, principalId, limit + 1);
    const page = rows.slice(0, limit);
    return { items: page.map(row => this.get(String(row.id), principalId)), nextCursor: Number(page.at(-1)?.rowid ?? after), hasMore: rows.length > limit };
  }

  messages(linkId: string, principalId: string, input: { after?: number; limit?: number } = {}) {
    this.load(linkId, principalId);
    const { after, limit } = parseNative(nativeReplaySchema, input);
    const rows = this.db.prepare('SELECT rowid,id FROM native_session_messages WHERE link=? AND rowid>? ORDER BY rowid LIMIT ?')
      .all(linkId, after, limit + 1);
    const page = rows.slice(0, limit);
    return { items: page.map(row => this.message(linkId, principalId, String(row.id))), nextCursor: Number(page.at(-1)?.rowid ?? after), hasMore: rows.length > limit };
  }

  hasPending(linkId: string, principalId: string, states: ('queued' | 'accepted' | 'unknown')[] = ['queued', 'accepted', 'unknown']) {
    this.load(linkId, principalId);
    parseNative(z.array(z.enum(['queued', 'accepted', 'unknown'])).min(1).max(3), states);
    const placeholders = states.map(() => '?').join(',');
    return Boolean(this.db.prepare(`SELECT id FROM native_session_messages WHERE link=? AND json_extract(body,'$.state') IN (${placeholders}) LIMIT 1`).get(linkId, ...states));
  }

  acquire(linkId: string, principalId: string, expectedEpoch: number, ownerId: string, launchId: string, leaseMs: number): NativeSessionLink {
    parseNative(epochSchema, expectedEpoch); parseNative(nativeIdSchema, ownerId); parseNative(nativeIdSchema, launchId); parseNative(leaseSchema, leaseMs);
    return this.transaction(() => {
      const link = this.load(linkId, principalId);
      if (link.owner || link.ownerEpoch !== expectedEpoch) throw new AppError('NATIVE_OWNER_CONFLICT', 'An existing owner, including a stale owner, cannot be stolen.', 409);
      link.ownerEpoch++;
      link.owner = { ownerId, launchId, ownerEpoch: link.ownerEpoch, leaseExpiresAt: this.now() + leaseMs, status: 'active' };
      this.save(link); return link;
    });
  }

  heartbeat(linkId: string, principalId: string, owner: NativeOwner, leaseMs: number): NativeSessionLink {
    parseNative(leaseSchema, leaseMs);
    return this.transaction(() => {
      const link = this.load(linkId, principalId); this.owner(link, owner);
      link.owner!.leaseExpiresAt = this.now() + leaseMs; this.save(link); return link;
    });
  }

  release(linkId: string, principalId: string, owner: NativeOwner): NativeSessionLink {
    return this.transfer(linkId, principalId, owner);
  }

  handoff(linkId: string, principalId: string, owner: NativeOwner, nextOwnerId: string, nextLaunchId: string, leaseMs: number): NativeSessionLink {
    parseNative(nativeIdSchema, nextOwnerId); parseNative(nativeIdSchema, nextLaunchId); parseNative(leaseSchema, leaseMs);
    return this.transfer(linkId, principalId, owner, { ownerId: nextOwnerId, launchId: nextLaunchId, leaseMs });
  }

  private transfer(linkId: string, principalId: string, owner: NativeOwner, next?: { ownerId: string; launchId: string; leaseMs: number }) {
    return this.transaction(() => {
      const link = this.load(linkId, principalId); this.owner(link, owner, false);
      parseNative(epochSchema, link.ownerEpoch);
      link.ownerEpoch++;
      link.owner = next ? { ownerId: next.ownerId, launchId: next.launchId, ownerEpoch: link.ownerEpoch, status: 'active', leaseExpiresAt: this.now() + next.leaseMs } : null;
      this.db.prepare('SELECT id,body FROM native_session_messages WHERE link=?').all(linkId).forEach(row => {
        const message: NativeOutboundMessage = JSON.parse(String(row.body));
        if (message.state === 'accepted') { message.state = 'unknown'; message.updatedAt = this.now(); this.saveMessage(linkId, message); }
      });
      this.save(link); return link;
    });
  }

  private saveMessage(linkId: string, message: NativeOutboundMessage) {
    this.db.prepare('INSERT INTO native_session_messages VALUES(?,?,?) ON CONFLICT(link,id) DO UPDATE SET body=excluded.body')
      .run(linkId, message.messageId, JSON.stringify(message));
  }

  message(linkId: string, principalId: string, messageId: string): NativeOutboundMessage {
    const link = this.get(linkId, principalId); parseNative(nativeIdSchema, messageId);
    const row = this.db.prepare('SELECT body FROM native_session_messages WHERE link=? AND id=?').get(linkId, messageId);
    if (!row) throw new AppError('NATIVE_NOT_FOUND', 'Outbound message not found.', 404);
    const message: NativeOutboundMessage = JSON.parse(String(row.body));
    if (message.state === 'accepted' && link.owner?.status === 'uncertain') message.state = 'unknown';
    return message;
  }

  enqueue(linkId: string, principalId: string, input: unknown): NativeOutboundMessage {
    const data = parseNative(nativeMessageSchema, input);
    return this.transaction(() => {
      const link = this.load(linkId, principalId);
      if (!link.capabilities.sendUserMessages) throw new AppError('NATIVE_CAPABILITY_DENIED', 'Native user message dispatch is unavailable.', 403);
      const row = this.db.prepare('SELECT body FROM native_session_messages WHERE link=? AND id=?').get(linkId, data.messageId);
      if (row) {
        const old: NativeOutboundMessage = JSON.parse(String(row.body));
        if (old.text !== data.text) throw new AppError('NATIVE_ID_REUSED', 'Message ID belongs to different text.', 409);
        return this.message(linkId, principalId, data.messageId);
      }
      const message: NativeOutboundMessage = { ...data, state: 'queued', execution: null, vendorRequestId: null, createdAt: this.now(), updatedAt: this.now() };
      this.saveMessage(linkId, message); return message;
    });
  }

  /** Persist uncertainty BEFORE vendor I/O. Never retry an unknown message automatically. */
  beginDispatch(linkId: string, principalId: string, owner: NativeOwner, source: NativeSource, messageId: string): NativeOutboundMessage {
    return this.transaction(() => {
      const link = this.load(linkId, principalId); this.owner(link, owner); this.source(link, source);
      if (!link.capabilities.sendUserMessages) throw new AppError('NATIVE_CAPABILITY_DENIED', 'Native dispatch is unavailable.', 403);
      const message = this.message(linkId, principalId, messageId);
      if (message.state !== 'queued') throw new AppError('NATIVE_DISPATCH_UNCERTAIN', 'This message was already dispatched; reconcile native evidence instead of resending.', 409);
      if (link.activeTurnId || this.db.prepare("SELECT id FROM native_session_messages WHERE link=? AND id<>? AND json_extract(body,'$.state') IN ('accepted','unknown') LIMIT 1").get(linkId, messageId))
        throw new AppError('NATIVE_TURN_CONFLICT', 'An active or uncertain dispatch must be reconciled before starting another turn.', 409);
      message.state = 'unknown'; message.execution = parseNative(nativeOwnerSchema, owner); message.updatedAt = this.now();
      this.saveMessage(linkId, message); return message;
    });
  }

  recordOutcome(linkId: string, principalId: string, owner: NativeOwner, source: NativeSource, messageId: string,
    state: 'accepted' | 'completed' | 'unknown', vendorRequestId: string): NativeOutboundMessage {
    parseNative(z.enum(['accepted', 'completed', 'unknown']), state); parseNative(nativeIdSchema, vendorRequestId);
    return this.transaction(() => {
      const link = this.load(linkId, principalId); this.owner(link, owner); this.source(link, source);
      const message = this.message(linkId, principalId, messageId);
      if (message.state === 'queued' || (message.state === 'completed' && state !== 'completed'))
        throw new AppError('NATIVE_STATE_CONFLICT', 'Invalid outbound message transition.', 409);
      if (!message.execution || canonical(message.execution) !== canonical(owner))
        throw new AppError('NATIVE_OWNER_CONFLICT', 'This dispatch belongs to another execution epoch; explicit reconciliation is required.', 409);
      if (message.vendorRequestId && message.vendorRequestId !== vendorRequestId)
        throw new AppError('NATIVE_ID_REUSED', 'Native request identity cannot be replaced.', 409);
      const duplicate = this.db.prepare('SELECT id FROM native_session_messages WHERE link=? AND id<>? AND json_extract(body,\'$.vendorRequestId\')=?')
        .get(linkId, messageId, vendorRequestId);
      if (duplicate) throw new AppError('NATIVE_ID_REUSED', 'Native request ID already belongs to another message.', 409);
      message.state = state; message.vendorRequestId = vendorRequestId; message.updatedAt = this.now();
      this.saveMessage(linkId, message); return message;
    });
  }

  appendEvent(linkId: string, principalId: string, owner: NativeOwner, input: unknown): NativeJournalEvent {
    const event = parseNative(nativePublicEventSchema, input);
    if (event.kind === 'tool.call' || (event.kind === 'tool.result' && event.data !== undefined)) event.data = sanitizeNativeData(event.data);
    return this.transaction(() => {
      const link = this.load(linkId, principalId); this.owner(link, owner); this.source(link, { vendor: event.vendor, vendorSessionId: event.vendorSessionId });
      if (!link.capabilities.publicEvents || (event.kind.startsWith('tool.') && !link.capabilities.toolEvents))
        throw new AppError('NATIVE_CAPABILITY_DENIED', 'This public event capability is unavailable.', 403);
      const body = canonical(event);
      const row = this.db.prepare('SELECT seq,body FROM native_session_events WHERE vendor=? AND session=? AND event_id=?')
        .get(event.vendor, event.vendorSessionId, event.vendorEventId);
      if (row) {
        if (row.body !== body) throw new AppError('NATIVE_ID_REUSED', 'Event ID belongs to different public content.', 409);
        return { seq: Number(row.seq), event: JSON.parse(String(row.body)) };
      }
      if (event.kind === 'turn.started') {
        if (link.activeTurnId && link.activeTurnId !== event.turnId) throw new AppError('NATIVE_TURN_CONFLICT', 'A native turn is already active.', 409);
        link.activeTurnId = event.turnId;
      }
      if (event.kind === 'turn.completed') {
        if (link.activeTurnId && link.activeTurnId !== event.turnId) throw new AppError('NATIVE_TURN_CONFLICT', 'Completion belongs to another active turn.', 409);
        link.activeTurnId = null;
      }
      // A public observation may fence execution, but cannot grant or release ownership.
      if (event.kind === 'owner.status' && event.status !== 'active') link.owner!.status = 'uncertain';
      const result = this.db.prepare('INSERT INTO native_session_events(link,vendor,session,event_id,body) VALUES(?,?,?,?,?)')
        .run(linkId, event.vendor, event.vendorSessionId, event.vendorEventId, body);
      this.save(link); return { seq: Number(result.lastInsertRowid), event };
    });
  }

  replay(linkId: string, principalId: string, input: { after?: number; limit?: number } = {}) {
    this.load(linkId, principalId);
    const { after, limit } = parseNative(nativeReplaySchema, input);
    const rows = this.db.prepare('SELECT seq,body FROM native_session_events WHERE link=? AND seq>? ORDER BY seq LIMIT ?').all(linkId, after, limit + 1);
    const items: NativeJournalEvent[] = rows.slice(0, limit).map(row => ({ seq: Number(row.seq), event: JSON.parse(String(row.body)) }));
    return { items, nextCursor: items.at(-1)?.seq ?? after, hasMore: rows.length > limit };
  }
}
