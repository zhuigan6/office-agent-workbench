import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { AppError, canonical, type DocumentBinding, type Operation, type RangeState } from '../contracts/index.ts';

export const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export const revision = (state: RangeState) => digest({ sheetId: state.sheetId, address: state.address,
  values: state.values, formulas: state.formulas, numberFormat: state.numberFormat });

export class Store {
  db: DatabaseSync;
  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, doc TEXT NOT NULL, hash TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, time INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS grants (hash TEXT PRIMARY KEY, doc TEXT NOT NULL, conversation TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, doc TEXT, turn TEXT, body TEXT NOT NULL);`);
    const pending = this.db.prepare('SELECT body FROM operations').all().map((r: any) => JSON.parse(r.body) as Operation);
    for (const op of pending) {
      if (op.status === 'running') this.updateOperation(op.id, 'unknown', { ...(op.result&&typeof op.result==='object'?op.result:{}),code: 'SERVICE_RESTART', message: 'Inspect document before retrying.' });
      if (op.status === 'queued') this.updateOperation(op.id, 'failed', { code: 'SERVICE_RESTART_NOT_STARTED', message: 'Operation was not dispatched. Submit a new operation after reviewing the document.' });
    }
  }
  close() { this.db.close(); }
  event(kind: string, body: unknown) {
    const id = randomUUID(), time = Date.now();
    const result = this.db.prepare('INSERT INTO events(id,kind,body,time) VALUES(?,?,?,?)').run(id, kind, JSON.stringify(body), time);
    return { sequence: Number(result.lastInsertRowid), eventId: id, kind, body, time };
  }
  events(after: number) {
    return this.db.prepare('SELECT * FROM events WHERE seq>? ORDER BY seq LIMIT 500').all(after).map((r: any) =>
      ({ sequence: r.seq, eventId: r.id, kind: r.kind, body: JSON.parse(r.body), time: r.time }));
  }
  bind(binding: DocumentBinding) {
    this.db.prepare('INSERT INTO documents VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body')
      .run(binding.documentId, JSON.stringify(binding));
    this.event('document.bound', binding);
  }
  documents(): DocumentBinding[] { return this.db.prepare('SELECT body FROM documents').all().map((r: any) => JSON.parse(r.body)); }
  getOperation(id: string): Operation | undefined {
    const row = this.db.prepare('SELECT body FROM operations WHERE id=?').get(id) as any;
    return row ? JSON.parse(row.body) : undefined;
  }
  begin(id: string, doc: string, kind: string, payload: unknown): { operation: Operation; fresh: boolean } {
    const existing = this.db.prepare('SELECT hash,body FROM operations WHERE id=?').get(id) as any;
    const hash = digest({ doc, kind, payload });
    if (existing) {
      if (existing.hash !== hash) throw new AppError('ID_REUSED', 'Operation ID already belongs to different arguments.', 409);
      return { operation: JSON.parse(existing.body), fresh: false };
    }
    const operation: Operation = { id, documentId: doc, kind, status: 'queued', payload, result: null, createdAt: Date.now(), updatedAt: Date.now() };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO operations VALUES(?,?,?,?)').run(id, doc, hash, JSON.stringify(operation));
      this.event('operation.changed', operation);
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    return { operation, fresh: true };
  }
  updateOperation(id: string, status: Operation['status'], result: unknown) {
    const operation = this.getOperation(id);
    if (!operation) throw new AppError('NOT_FOUND', 'Operation not found.', 404);
    Object.assign(operation, { status, result, updatedAt: Date.now() });
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('UPDATE operations SET body=? WHERE id=?').run(JSON.stringify(operation), id);
      this.event('operation.changed', operation);
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    return operation;
  }
  operations(): Operation[] { return this.db.prepare('SELECT body FROM operations ORDER BY rowid DESC LIMIT 500').all().map((r: any) => JSON.parse(r.body)); }
  addGrant(token: string, doc: string, conversation: string) {
    this.db.prepare('INSERT INTO grants VALUES(?,?,?)').run(digest(token), doc, conversation);
  }
  grant(token: string) { return this.db.prepare('SELECT doc,conversation FROM grants WHERE hash=?').get(digest(token)) as {doc: string; conversation: string} | undefined; }
  linkConversation(id: string, doc: string, body: unknown) {
    this.db.prepare('INSERT INTO conversations VALUES(?,?,NULL,?) ON CONFLICT(id) DO UPDATE SET doc=excluded.doc,body=excluded.body')
      .run(id, doc, JSON.stringify(body));
  }
  conversations() { return this.db.prepare('SELECT * FROM conversations ORDER BY rowid DESC').all().map((r: any) => ({...r, body: JSON.parse(r.body)})); }
  turn(id: string, turn: string | null) { this.db.prepare('UPDATE conversations SET turn=? WHERE id=?').run(turn, id); }
}
