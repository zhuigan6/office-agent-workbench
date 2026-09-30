import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { NativeSessionStore } from '../packages/native-sessions/store.ts';
import { CodexLinkedSession } from '../packages/native-sessions/codex-session.ts';

class Peer extends EventEmitter {
  calls: any[] = []; wrongIdentity = false; failQueue = false;
  async request(method: string, params: any): Promise<unknown> {
    this.calls.push({ method, params });
    if (method === 'thread/resume') return { thread: { id: this.wrongIdentity ? 'fork' : 'native' }, cwd: 'E:\\work' };
    if (this.failQueue) throw Error('Disconnected');
    return { queuedSubmission: { id: 'queue1', clientUserMessageId: params.clientUserMessageId } };
  }
  event(method: string, data: object) { this.emit('notification', { method, params: { threadId: 'native', ...data } }); }
}

test('native terminal turns are journaled and block Workbench sends without a local receipt', async () => {
  const f=fixture();
  try {
    await f.session.resume();
    f.peer.event('turn/started',{turn:{id:'external-turn'}});
    await assert.rejects(f.session.send('local-message','competing'),/active or uncertain/);
    f.peer.event('item/completed',{turnId:'external-turn',item:{type:'userMessage',id:'external-user',clientId:'terminal-message',content:[{type:'text',text:'terminal text'}]}});
    f.peer.event('item/completed',{turnId:'external-turn',item:{type:'agentMessage',id:'external-answer',text:'shared reply'}});
    f.peer.event('turn/completed',{turn:{id:'external-turn'}});
    assert.equal(f.store.get('link','owner').activeTurnId,null);
    assert.deepEqual(f.store.replay('link','owner').items.map(i=>i.event.kind),['turn.started','user.text','assistant.text','turn.completed']);
    assert.equal((await f.session.send('local-message','next')).state,'accepted');
  } finally { f.session.disconnect();f.db.close(); }
});
function fixture() {
  const db = new DatabaseSync(':memory:'), store = new NativeSessionStore(db), peer = new Peer();
  store.link('owner', { linkId: 'link', threadId: 'local', vendor: 'codex', vendorSessionId: 'native', workingDirectory: 'E:\\work',
    ownerLink: { principalId: 'owner' }, capabilities: { publicEvents: true, toolEvents: true, sendUserMessages: true } });
  store.acquire('link', 'owner', 0, 'worker', 'launch', 60_000);
  const session = new CodexLinkedSession(store, peer, 'link', 'owner', { ownerId: 'worker', launchId: 'launch', ownerEpoch: 1 });
  return { db, store, peer, session };
}

test('explicit native resume never accepts a fork and fences a mismatched identity', async () => {
  const f = fixture(); try {
    f.peer.wrongIdentity = true; await assert.rejects(f.session.resume(), /differs/);
    assert.equal(f.store.get('link', 'owner').owner?.status, 'uncertain');
    assert.equal(f.peer.calls.length, 1); await assert.rejects(f.session.send('m', 'hello'));
  } finally { f.session.disconnect(); f.db.close(); }
});

test('native sends use the shared queue, preserve receipts and complete only matching public turns', async () => {
  const f = fixture(); try {
    await f.session.resume(); const accepted = await f.session.send('m1', 'hello');
    assert.equal(accepted.state, 'accepted'); assert.equal(f.peer.calls[1].method, 'thread/queue/add');
    assert.equal((await f.session.send('m1', 'hello')).vendorRequestId, 'queue1'); assert.equal(f.peer.calls.length, 2);
    await assert.rejects(f.session.send('m2', 'other'), /active or uncertain/);
    f.peer.event('turn/started', { turn: { id: 'turn' } });
    f.peer.event('item/completed', { turnId: 'turn', item: { type: 'userMessage', id: 'user1', clientId: 'm1', content: [{ type: 'text', text: 'hello' }] } });
    f.peer.event('item/completed', { turnId: 'turn', item: { type: 'agentMessage', id: 'answer1', text: 'reply' } });
    f.peer.event('turn/completed', { turn: { id: 'turn' } });
    assert.equal(f.store.message('link', 'owner', 'm1').state, 'completed');
    assert.deepEqual(f.store.replay('link', 'owner').items.map(i => i.event.kind), ['turn.started', 'user.text', 'assistant.text', 'turn.completed']);
  } finally { f.session.disconnect(); f.db.close(); }
});

test('loss after dispatch preserves unknown outcome and never resends on reconnection', async () => {
  const f = fixture(); try {
    await f.session.resume(); f.peer.failQueue = true;
    await assert.rejects(f.session.send('m', 'hello'));
    assert.equal(f.store.message('link', 'owner', 'm').state, 'unknown');
    assert.equal(f.store.get('link', 'owner').owner?.status, 'uncertain');
    await assert.rejects(f.session.send('m', 'hello')); assert.equal(f.peer.calls.length, 2);
  } finally { f.session.disconnect(); f.db.close(); }
});

test('fresh owned thread/start acknowledgement attaches without resuming an unpersisted empty thread', () => {
  const f = fixture(); try {
    f.session.attachCreated({ thread: { id: 'native' }, cwd: 'E:\\work' });
    assert.equal(f.peer.calls.length, 0);
    f.peer.event('item/completed', { turnId: 'turn', item: { type: 'agentMessage', id: 'a', text: 'public' } });
    assert.equal(f.store.replay('link', 'owner').items[0].event.kind, 'assistant.text');
    assert.throws(() => f.session.attachCreated({ thread: { id: 'fork' }, cwd: 'E:\\work' }));
  } finally { f.session.disconnect(); f.db.close(); }
});

test('resume-time public events are buffered until identity has been verified', async () => {
  const f = fixture(); try {
    f.peer.request = async () => {
      f.peer.event('item/completed', { turnId: 'turn', item: { type: 'agentMessage', id: 'a', text: 'public' } });
      assert.equal(f.store.replay('link', 'owner').items.length, 0);
      return { thread: { id: 'native' }, cwd: 'E:\\work' };
    };
    await f.session.resume(); assert.equal(f.store.replay('link', 'owner').items.length, 1);
  } finally { f.session.disconnect(); f.db.close(); }
});
