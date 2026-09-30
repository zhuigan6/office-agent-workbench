import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { NativeSessions } from '../packages/native-sessions/manager.ts';
import { readNativeDrafts } from '../apps/workbench/src/native-drafts.ts';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';

test('offline native history remains readable without launching or implicitly replacing a session', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const manager = new NativeSessions(db, 'E:\\unused', () => {});
    manager.store.link('local-workbench-user', { linkId: 'old', threadId: 'old', vendor: 'codex', vendorSessionId: 'original', workingDirectory: 'E:\\unused',
      ownerLink: { principalId: 'local-workbench-user' }, capabilities: { publicEvents: true, sendUserMessages: true, toolEvents: true } });
    assert.equal(manager.list().items[0].connected, false);
    assert.equal(manager.list().items[0].terminalSharing, false);
    await assert.rejects(manager.terminal('old'), /active, verified/);
    assert.equal(manager.list().items[0].vendorSessionId, 'original');
    await assert.rejects(manager.send('old', { messageId: 'new', text: 'hello' }), /offline/);
    assert.deepEqual(manager.events('old').items, []);
    assert.deepEqual(await manager.close('old'), { closed: true, historyRetained: true });
    assert.equal(manager.list().items.length, 1); assert.equal(manager.busy, false);
    await manager.stopAll();
  } finally { db.close(); }
});

test('external active turns appear pending and offline links cannot issue terminal grants', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const manager = new NativeSessions(db, 'E:\\unused', () => {});
    manager.store.link('local-workbench-user', { linkId: 'external', threadId: 'external', vendor: 'codex', vendorSessionId: 'original', workingDirectory: 'E:\\unused',
      ownerLink: { principalId: 'local-workbench-user' }, capabilities: { publicEvents: true, sendUserMessages: true, toolEvents: true } });
    manager.store.acquire('external','local-workbench-user',0,'worker','launch',60000);
    manager.store.appendEvent('external','local-workbench-user',{ownerId:'worker',launchId:'launch',ownerEpoch:1},
      {vendor:'codex',vendorSessionId:'original',vendorEventId:'turn1',kind:'turn.started',turnId:'terminal-turn'});
    assert.equal(manager.list().items[0].pending,true);
    await assert.rejects(manager.terminal('external'), /active, verified/);
  } finally { db.close(); }
});

test('native tab drafts reject malformed/oversized entries and cannot overwrite ordinary task drafts', () => {
  const id = '00000000-0000-0000-0000-000000000001';
  assert.deepEqual(readNativeDrafts({ getItem: () => JSON.stringify({ [id]: 'keep', '__proto__': 'bad', other: 'ignore' }) }), { [id]: 'keep' });
  assert.deepEqual(readNativeDrafts({ getItem: () => JSON.stringify({ [id]: 'x'.repeat(32769) }) }), {});
  assert.deepEqual(readNativeDrafts({ getItem: () => '{broken' }), {});
});

test('terminal continuation refuses a replaced vendor binary without issuing a grant or creating a home', async () => {
  const db=new DatabaseSync(':memory:'),directory=await fs.mkdtemp(path.join(os.tmpdir(),'workbench-native-drift-'));
  const binary=path.join(directory,'fixture.exe');
  try {
    await fs.writeFile(binary,'replaced binary');
    const manager=new NativeSessions(db,directory,()=>{});
    manager.store.link('local-workbench-user',{linkId:'drift',threadId:'drift',vendor:'codex',vendorSessionId:'owned',workingDirectory:directory,
      ownerLink:{principalId:'local-workbench-user'},capabilities:{publicEvents:true,sendUserMessages:true,toolEvents:true}});
    manager.store.acquire('drift','local-workbench-user',0,'worker','launch',60000);
    (manager as any).runtimes.set('drift',{server:{binary},binaryHash:createHash('sha256').update('original binary').digest('hex')});
    await assert.rejects(manager.terminal('drift'),{code:'NATIVE_RUNTIME_CHANGED'});
    assert.deepEqual(await fs.readdir(directory),['fixture.exe']);
  } finally { db.close();await fs.unlink(binary);await fs.rmdir(directory); }
});
