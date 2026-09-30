import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppError } from '../packages/contracts/index.ts';
import { NATIVE_SESSION_LIMITS, type NativeLinkInput, type NativeOwner } from '../packages/contracts/native-session.ts';
import { NativeSessionStore } from '../packages/native-sessions/store.ts';

const source = { vendor: 'codex' as const, vendorSessionId: 'native-1' };
const input: NativeLinkInput = {
  ...source, linkId: 'link-1', threadId: 'thread-1', workingDirectory: 'E:\\work',
  ownerLink: { principalId: 'alice' }, capabilities: { publicEvents: true, toolEvents: true, sendUserMessages: true },
};
const owner: NativeOwner = { ownerId: 'worker', launchId: 'launch-1', ownerEpoch: 1 };
const fails = (action: () => unknown, code: string) => assert.throws(action, (e: unknown) => e instanceof AppError && e.code === code);
function fixture(run: (store: NativeSessionStore, db: DatabaseSync, tick: (n: number) => void) => void) {
  const db = new DatabaseSync(':memory:'); let time = 1000;
  try {
    const store = new NativeSessionStore(db, () => time);
    store.link('alice', input); store.acquire('link-1', 'alice', 0, 'worker', 'launch-1', 100);
    run(store, db, n => { time += n; });
  } finally { db.close(); }
}
const event = (id: string, text = id) => ({ ...source, vendorEventId: id, kind: 'assistant.text' as const, text });

test('explicit stable links, strict contracts, principal isolation and immutable native identity', () => fixture(store => {
  assert.equal(store.link('alice', input).ownerEpoch, 1);
  assert.equal(store.list('alice').items[0].workingDirectory, 'E:\\work');
  assert.deepEqual(store.list('bob').items, []);
  fails(() => store.get('link-1', 'bob'), 'NATIVE_FORBIDDEN');
  fails(() => store.link('bob', input), 'NATIVE_FORBIDDEN');
  fails(() => store.link('alice', { ...input, vendorSessionId: 'fork' }), 'NATIVE_LINK_CONFLICT');
  fails(() => store.link('alice', { ...input, linkId: 'other' }), 'NATIVE_LINK_CONFLICT');
  fails(() => store.link('alice', { ...input, extra: true } as NativeLinkInput), 'NATIVE_INVALID_INPUT');
  fails(() => store.appendEvent('link-1', 'alice', owner, { ...event('fork'), vendorSessionId: 'fork' }), 'NATIVE_SOURCE_MISMATCH');
  fails(() => store.appendEvent('link-1', 'bob', owner, event('denied')), 'NATIVE_FORBIDDEN');
  assert.equal(store.replay('link-1', 'alice').items.length, 0);
}));

test('single execution owner, heartbeat, stale uncertainty and epoch-guarded release/handoff', () => fixture((store, _db, tick) => {
  fails(() => store.acquire('link-1', 'alice', 1, 'other', 'launch-2', 100), 'NATIVE_OWNER_CONFLICT');
  tick(50); store.heartbeat('link-1', 'alice', owner, 100); tick(99);
  assert.equal(store.get('link-1', 'alice').owner!.status, 'active');
  tick(1); assert.equal(store.get('link-1', 'alice').owner!.status, 'uncertain');
  fails(() => store.heartbeat('link-1', 'alice', owner, 100), 'NATIVE_OWNER_UNCERTAIN');
  fails(() => store.acquire('link-1', 'alice', 1, 'other', 'launch-2', 100), 'NATIVE_OWNER_CONFLICT');
  fails(() => store.release('link-1', 'alice', { ...owner, launchId: 'wrong' }), 'NATIVE_OWNER_CONFLICT');
  const next = store.handoff('link-1', 'alice', owner, 'other', 'launch-2', 100);
  assert.equal(next.ownerEpoch, 2);
  fails(() => store.appendEvent('link-1', 'alice', owner, event('old')), 'NATIVE_OWNER_CONFLICT');
  store.release('link-1', 'alice', { ownerId: 'other', launchId: 'launch-2', ownerEpoch: 2 });
  fails(() => store.acquire('link-1', 'alice', 2, 'worker', 'launch-3', 100), 'NATIVE_OWNER_CONFLICT');
  assert.equal(store.acquire('link-1', 'alice', 3, 'worker', 'launch-3', 100).ownerEpoch, 4);
}));

test('outbound IDs, acceptance/completion, no automatic unknown redispatch and request identity', () => fixture(store => {
  const queued = store.enqueue('link-1', 'alice', { messageId: 'm1', text: 'hello' });
  assert.equal(queued.state, 'queued');
  assert.deepEqual(store.enqueue('link-1', 'alice', { messageId: 'm1', text: 'hello' }), queued);
  fails(() => store.enqueue('link-1', 'alice', { messageId: 'm1', text: 'different' }), 'NATIVE_ID_REUSED');
  fails(() => store.recordOutcome('link-1', 'alice', owner, source, 'm1', 'accepted', 'r1'), 'NATIVE_STATE_CONFLICT');
  fails(() => store.beginDispatch('link-1', 'bob', owner, source, 'm1'), 'NATIVE_FORBIDDEN');
  fails(() => store.beginDispatch('link-1', 'alice', owner, { ...source, vendorSessionId: 'fork' }, 'm1'), 'NATIVE_SOURCE_MISMATCH');
  assert.equal(store.beginDispatch('link-1', 'alice', owner, source, 'm1').state, 'unknown');
  fails(() => store.beginDispatch('link-1', 'alice', owner, source, 'm1'), 'NATIVE_DISPATCH_UNCERTAIN');
  assert.equal(store.recordOutcome('link-1', 'alice', owner, source, 'm1', 'accepted', 'r1').state, 'accepted');
  fails(() => store.recordOutcome('link-1', 'alice', owner, source, 'm1', 'completed', 'other'), 'NATIVE_ID_REUSED');
  assert.equal(store.recordOutcome('link-1', 'alice', owner, source, 'm1', 'completed', 'r1').state, 'completed');
  store.recordOutcome('link-1', 'alice', owner, source, 'm1', 'completed', 'r1');
  fails(() => store.recordOutcome('link-1', 'alice', owner, source, 'm1', 'unknown', 'r1'), 'NATIVE_STATE_CONFLICT');
  store.enqueue('link-1', 'alice', { messageId: 'm2', text: 'next' });
  store.beginDispatch('link-1', 'alice', owner, source, 'm2');
  fails(() => store.recordOutcome('link-1', 'alice', owner, source, 'm2', 'accepted', 'r1'), 'NATIVE_ID_REUSED');
  const page = store.messages('link-1', 'alice', { limit: 1 });
  assert.equal(page.hasMore, true);
  assert.equal(store.messages('link-1', 'alice', { after: page.nextCursor }).items[0].messageId, 'm2');
}));

test('native active/uncertain turns block new sends and handoff cannot rewrite an older dispatch', () => fixture(store => {
  store.enqueue('link-1', 'alice', { messageId: 'first', text: 'one' });
  store.enqueue('link-1', 'alice', { messageId: 'second', text: 'two' });
  store.appendEvent('link-1', 'alice', owner, { ...source, vendorEventId: 'start', kind: 'turn.started', turnId: 'turn' });
  fails(() => store.beginDispatch('link-1', 'alice', owner, source, 'first'), 'NATIVE_TURN_CONFLICT');
  store.appendEvent('link-1', 'alice', owner, { ...source, vendorEventId: 'end', kind: 'turn.completed', turnId: 'turn' });
  store.beginDispatch('link-1', 'alice', owner, source, 'first');
  fails(() => store.beginDispatch('link-1', 'alice', owner, source, 'second'), 'NATIVE_TURN_CONFLICT');
  store.handoff('link-1', 'alice', owner, 'other', 'launch-2', 100);
  const nextOwner = { ownerId: 'other', launchId: 'launch-2', ownerEpoch: 2 };
  fails(() => store.recordOutcome('link-1', 'alice', nextOwner, source, 'first', 'completed', 'request'), 'NATIVE_OWNER_CONFLICT');
  fails(() => store.beginDispatch('link-1', 'alice', nextOwner, source, 'second'), 'NATIVE_TURN_CONFLICT');
}));

test('public journal is idempotent, strict, paginated and isolated across links/vendors', () => fixture(store => {
  const first = store.appendEvent('link-1', 'alice', owner, event('e1'));
  assert.deepEqual(store.appendEvent('link-1', 'alice', owner, event('e1')), first);
  fails(() => store.appendEvent('link-1', 'alice', owner, event('e1', 'changed')), 'NATIVE_ID_REUSED');
  const other = { ...input, vendor: 'claude' as const, linkId: 'link-2', threadId: 'thread-2' };
  store.link('alice', other); store.acquire('link-2', 'alice', 0, 'worker', 'launch-1', 100);
  store.appendEvent('link-2', 'alice', owner, { ...event('e1'), vendor: 'claude' });
  store.appendEvent('link-1', 'alice', owner, event('e2'));
  store.appendEvent('link-1', 'alice', owner, event('e3'));
  const page = store.replay('link-1', 'alice', { limit: 2 });
  assert.deepEqual(page.items.map(e => e.event.vendorEventId), ['e1', 'e2']);
  assert.equal(page.hasMore, true);
  const last = store.replay('link-1', 'alice', { after: page.nextCursor, limit: 2 });
  assert.deepEqual(last.items.map(e => e.event.vendorEventId), ['e3']); assert.equal(last.hasMore, false);
  assert.equal(store.replay('link-1', 'alice', { after: last.nextCursor }).nextCursor, last.nextCursor);
  for (const bad of [{ after: -1 }, { limit: 101 }, { after: 0.1 }]) fails(() => store.replay('link-1', 'alice', bad), 'NATIVE_INVALID_INPUT');
  for (const kind of ['thinking', 'system', 'developer', 'reasoning', 'unknown'])
    fails(() => store.appendEvent('link-1', 'alice', owner, { ...event('bad'), kind }), 'NATIVE_INVALID_INPUT');
  fails(() => store.appendEvent('link-1', 'alice', owner, { ...event('bad'), channel: 'analysis' }), 'NATIVE_INVALID_INPUT');
  fails(() => store.appendEvent('link-1', 'alice', owner, event('big', 'x'.repeat(NATIVE_SESSION_LIMITS.text + 1))), 'NATIVE_INVALID_INPUT');
}));

test('pending dispatch protection covers messages beyond the first history page', () => fixture(store => {
  for (let index = 0; index < 105; index++) {
    const messageId = 'old' + index;
    store.enqueue('link-1', 'alice', { messageId, text: 'old' });
    store.beginDispatch('link-1', 'alice', owner, source, messageId);
    store.recordOutcome('link-1', 'alice', owner, source, messageId, 'completed', 'request' + index);
  }
  store.enqueue('link-1', 'alice', { messageId: 'latest', text: 'new' });
  assert.equal(store.messages('link-1', 'alice', { limit: 100 }).items.some(message => message.state !== 'completed'), false);
  assert.equal(store.hasPending('link-1', 'alice'), true);
  assert.equal(store.hasPending('link-1', 'alice', ['accepted', 'unknown']), false);
  store.beginDispatch('link-1', 'alice', owner, source, 'latest');
  assert.equal(store.hasPending('link-1', 'alice', ['unknown']), true);
}));

test('bounded structured tool data omits nested credential/private fields and rejects invalid JSON', () => fixture((store, db) => {
  const tool = { ...source, vendorEventId: 'tool', kind: 'tool.call', toolCallId: 'call', name: 'read', data: {
    path: 'file', api_key: 'SECRET', nested: [{ Authorization: 'SECRET', password: 'SECRET', reasoning: 'PRIVATE', ok: true }],
    developer: 'PRIVATE', refreshToken: 'SECRET', '__proto__': null,
  } };
  // A JSON-parsed payload has an ordinary prototype, including suspicious own keys.
  const clean = store.appendEvent('link-1', 'alice', owner, JSON.parse(JSON.stringify(tool)));
  assert.deepEqual('data' in clean.event ? clean.event.data : null, { path: 'file', nested: [{ ok: true }] });
  assert.ok(!String(db.prepare('SELECT body FROM native_session_events').get()!.body).includes('SECRET'));
  store.appendEvent('link-1', 'alice', owner, { ...tool, data: { path: 'file', nested: [{ ok: true }] } });
  for (const data of [new Date(), { x: undefined }, { x: Infinity }, Array(4097).fill(0), { x: 'x'.repeat(32769) }])
    assert.throws(() => store.appendEvent('link-1', 'alice', owner, { ...tool, vendorEventId: 'bad', data }), AppError);
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  fails(() => store.appendEvent('link-1', 'alice', owner, { ...tool, data: cycle }), 'NATIVE_DATA_LIMIT');
  fails(() => store.appendEvent('link-1', 'alice', owner, { ...tool, data: Array(4).fill('x'.repeat(32768)) }), 'NATIVE_DATA_LIMIT');
}));

test('capabilities and public owner observations cannot grant execution ownership', () => fixture(store => {
  store.link('alice', { ...input, linkId: 'disabled', threadId: 'disabled', vendorSessionId: 'disabled', capabilities: { publicEvents: false, toolEvents: false, sendUserMessages: false } });
  store.acquire('disabled', 'alice', 0, 'worker', 'launch-1', 100);
  fails(() => store.enqueue('disabled', 'alice', { messageId: 'm', text: 'no' }), 'NATIVE_CAPABILITY_DENIED');
  fails(() => store.appendEvent('disabled', 'alice', owner, { ...event('e'), vendorSessionId: 'disabled' }), 'NATIVE_CAPABILITY_DENIED');
  store.link('alice', { ...input, linkId: 'text-only', threadId: 'text-only', vendorSessionId: 'text-only', capabilities: { ...input.capabilities, toolEvents: false } });
  store.acquire('text-only', 'alice', 0, 'worker', 'launch-1', 100);
  fails(() => store.appendEvent('text-only', 'alice', owner, { ...source, vendorSessionId: 'text-only', vendorEventId: 'tool', kind: 'tool.result', toolCallId: 'call', text: 'result' }), 'NATIVE_CAPABILITY_DENIED');
  store.appendEvent('link-1', 'alice', owner, { ...source, vendorEventId: 'status', kind: 'owner.status', status: 'released' });
  assert.equal(store.get('link-1', 'alice').owner!.status, 'uncertain');
  fails(() => store.acquire('link-1', 'alice', 1, 'new', 'launch-2', 100), 'NATIVE_OWNER_CONFLICT');
  fails(() => store.heartbeat('link-1', 'alice', owner, 100), 'NATIVE_OWNER_UNCERTAIN');
}));

test('public user/tool results and turn state are atomic; nested writes cannot undo dispatch markers', () => fixture((store, db) => {
  store.appendEvent('link-1', 'alice', owner, { ...event('user'), kind: 'user.text', text: 'question' });
  store.appendEvent('link-1', 'alice', owner, { ...source, vendorEventId: 'result', kind: 'tool.result', toolCallId: 'call', text: 'done', data: { ok: true, token: 'omit' } });
  const started = { ...source, vendorEventId: 'started', kind: 'turn.started', turnId: 'turn' };
  const first = store.appendEvent('link-1', 'alice', owner, started);
  fails(() => store.appendEvent('link-1', 'alice', owner, { ...started, vendorEventId: 'other', turnId: 'other' }), 'NATIVE_TURN_CONFLICT');
  fails(() => store.appendEvent('link-1', 'alice', owner, { ...started, vendorEventId: 'wrong-end', kind: 'turn.completed', turnId: 'other' }), 'NATIVE_TURN_CONFLICT');
  assert.equal(store.get('link-1', 'alice').activeTurnId, 'turn');
  assert.equal(store.replay('link-1', 'alice').items.length, 3);
  store.appendEvent('link-1', 'alice', owner, { ...started, vendorEventId: 'end', kind: 'turn.completed' });
  assert.deepEqual(store.appendEvent('link-1', 'alice', owner, started), first);
  assert.equal(store.get('link-1', 'alice').activeTurnId, null);
  store.enqueue('link-1', 'alice', { messageId: 'm', text: 'question' });
  db.exec('BEGIN');
  try { fails(() => store.beginDispatch('link-1', 'alice', owner, source, 'm'), 'NATIVE_TRANSACTION_CONFLICT'); }
  finally { db.exec('ROLLBACK'); }
  assert.equal(store.message('link-1', 'alice', 'm').state, 'queued');
  store.beginDispatch('link-1', 'alice', owner, source, 'm');
  assert.equal(new NativeSessionStore(db).message('link-1', 'alice', 'm').state, 'unknown');
  fails(() => store.enqueue('link-1', 'alice', { messageId: 'large', text: 'x'.repeat(32769) }), 'NATIVE_INVALID_INPUT');
  fails(() => store.appendEvent('link-1', 'alice', owner, { ...source, vendorEventId: 'missing-data', kind: 'tool.call', toolCallId: 'call', name: 'read' }), 'NATIVE_INVALID_DATA');
}));

test('temporary file restart preserves threads, cursors, queued/unknown requests and fenced owners', () => {
  const dir = mkdtempSync(join(tmpdir(), 'native-sessions-')); const path = join(dir, 'test.sqlite');
  let db = new DatabaseSync(path); let time = 1000;
  try {
    let store = new NativeSessionStore(db, () => time);
    store.link('alice', input); store.acquire('link-1', 'alice', 0, 'worker', 'launch-1', 100);
    store.enqueue('link-1', 'alice', { messageId: 'queued', text: 'queued' });
    store.enqueue('link-1', 'alice', { messageId: 'finished', text: 'finished' });
    store.beginDispatch('link-1', 'alice', owner, source, 'finished');
    store.recordOutcome('link-1', 'alice', owner, source, 'finished', 'completed', 'finished-request');
    store.enqueue('link-1', 'alice', { messageId: 'accepted', text: 'accepted' });
    store.beginDispatch('link-1', 'alice', owner, source, 'accepted');
    store.recordOutcome('link-1', 'alice', owner, source, 'accepted', 'accepted', 'request');
    const start = store.appendEvent('link-1', 'alice', owner, { ...source, vendorEventId: 'start', kind: 'turn.started', turnId: 'turn' });
    const secondDb = new DatabaseSync(path);
    try {
      const concurrent = new NativeSessionStore(secondDb, () => time);
      fails(() => concurrent.acquire('link-1', 'alice', 1, 'other', 'launch-2', 100), 'NATIVE_OWNER_CONFLICT');
      assert.equal(concurrent.get('link-1', 'alice').activeTurnId, 'turn');
    } finally { secondDb.close(); }
    db.close(); time += 101; db = new DatabaseSync(path); store = new NativeSessionStore(db, () => time);
    assert.equal(store.get('link-1', 'alice').activeTurnId, 'turn');
    assert.equal(store.message('link-1', 'alice', 'queued').state, 'queued');
    assert.equal(store.message('link-1', 'alice', 'finished').state, 'completed');
    assert.equal(store.message('link-1', 'alice', 'accepted').state, 'unknown');
    assert.equal(store.enqueue('link-1', 'alice', { messageId: 'accepted', text: 'accepted' }).state, 'unknown');
    assert.equal(store.get('link-1', 'alice').owner!.status, 'uncertain');
    store.handoff('link-1', 'alice', owner, 'new', 'launch-2', 100);
    const next: NativeOwner = { ownerId: 'new', launchId: 'launch-2', ownerEpoch: 2 };
    fails(() => store.beginDispatch('link-1', 'alice', next, source, 'finished'), 'NATIVE_DISPATCH_UNCERTAIN');
    fails(() => store.beginDispatch('link-1', 'alice', next, source, 'accepted'), 'NATIVE_DISPATCH_UNCERTAIN');
    fails(() => store.recordOutcome('link-1', 'alice', next, source, 'accepted', 'completed', 'request'), 'NATIVE_OWNER_CONFLICT');
    const end = store.appendEvent('link-1', 'alice', next, { ...source, vendorEventId: 'end', kind: 'turn.completed', turnId: 'turn' });
    assert.ok(end.seq > start.seq); assert.equal(store.get('link-1', 'alice').activeTurnId, null);
    assert.deepEqual(store.replay('link-1', 'alice', { after: start.seq }).items, [end]);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
