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
    await assert.rejects(manager.resume('external'),{code:'NATIVE_OWNER_UNCERTAIN'});
  } finally { db.close(); }
});

test('native tab drafts reject malformed/oversized entries and cannot overwrite ordinary task drafts', () => {
  const id = '00000000-0000-0000-0000-000000000001';
  assert.deepEqual(readNativeDrafts({ getItem: () => JSON.stringify({ [id]: 'keep', '__proto__': 'bad', other: 'ignore' }) }), { [id]: 'keep' });
  assert.deepEqual(readNativeDrafts({ getItem: () => JSON.stringify({ [id]: 'x'.repeat(32769) }) }), {});
  assert.deepEqual(readNativeDrafts({ getItem: () => '{broken' }), {});
});

test('only a clean released idle link with runtime metadata advertises explicit resume',async()=>{
  const db=new DatabaseSync(':memory:');
  try{
    const manager=new NativeSessions(db,'E:\\unused',()=>{});
    manager.store.link('local-workbench-user',{linkId:'released',threadId:'released',vendor:'codex',vendorSessionId:'original',workingDirectory:'E:\\unused',
      ownerLink:{principalId:'local-workbench-user'},capabilities:{publicEvents:true,sendUserMessages:true,toolEvents:true}});
    assert.equal(manager.list().items[0].canResume,false);
    db.prepare('INSERT INTO native_session_metadata VALUES(?,?,?)').run('released','kept',JSON.stringify({document:{taskId:'task',documentId:'doc',name:'Bound document'}}));
    assert.equal(manager.list().items[0].canResume,true);
    assert.equal(manager.document('released').documentId,'doc');
    manager.store.enqueue('released','local-workbench-user',{messageId:'not-dispatched',text:'keep'});
    assert.equal(manager.list().items[0].canResume,false);
    await assert.rejects(manager.resume('released'),{code:'NATIVE_OWNER_UNCERTAIN'});
    assert.equal(manager.list().items[0].vendorSessionId,'original');
  }finally{db.close();}
});

test('native send preserves the original prepared selection on retry and rejects reused message IDs',async()=>{
  const db=new DatabaseSync(':memory:');
  try{
    const manager=new NativeSessions(db,'E:\\unused',()=>{});let prepared=0,applied=0;const sent:string[]=[];
    manager.store.link('local-workbench-user',{linkId:'selected',threadId:'selected',vendor:'codex',vendorSessionId:'owned',workingDirectory:'E:\\unused',
      ownerLink:{principalId:'local-workbench-user'},capabilities:{publicEvents:true,sendUserMessages:true,toolEvents:true}});
    (manager as any).runtimes.set('selected',{bridge:{provider:{prepareMessage:async(text:string,selectionId:string)=>{prepared++;return {text:text+' fixed '+selectionId+' revision'+prepared,apply:()=>{applied++;}};}}},session:{send:async(_id:string,text:string)=>{sent.push(text);return {state:'accepted'};}}});
    const message={messageId:'m1',text:'edit here',selectionId:'reference'};
    await manager.send('selected',message);await manager.send('selected',message);
    assert.equal(prepared,1);assert.equal(applied,1);assert.equal(sent[0],sent[1]);
    await assert.rejects(manager.send('selected',{...message,selectionId:'another'}),{code:'NATIVE_ID_REUSED'});
    await assert.rejects(manager.send('selected',{...message,text:'different'}),{code:'NATIVE_ID_REUSED'});
    assert.equal(sent.length,2);
  }finally{db.close();}
});

test('message preparation is visibly pending and cannot race idle close or a different send',async()=>{
  const db=new DatabaseSync(':memory:');let release!:()=>void;
  const prepared=new Promise<void>(resolve=>{release=resolve;});
  try{
    const manager=new NativeSessions(db,'E:\\unused',()=>{});
    manager.store.link('local-workbench-user',{linkId:'preparing',threadId:'preparing',vendor:'codex',vendorSessionId:'owned',workingDirectory:'E:\\unused',ownerLink:{principalId:'local-workbench-user'},capabilities:{publicEvents:true,sendUserMessages:true,toolEvents:true}});
    const bridge={busy:false,provider:{prepareMessage:async(text:string)=>{await prepared;return {text,apply:()=>{}};}}};
    (manager as any).runtimes.set('preparing',{bridge,session:{send:async()=>({state:'accepted'})}});
    const send=manager.send('preparing',{messageId:'one',text:'same selected task'});
    assert.equal(manager.list().items[0].pending,true);assert.equal(manager.busy,true);
    await assert.rejects(manager.close('preparing'),{code:'NATIVE_TURN_CONFLICT'});
    await assert.rejects(manager.send('preparing',{messageId:'different',text:'do not interleave'}),{code:'NATIVE_TURN_CONFLICT'});
    release();await send;assert.equal(manager.list().items[0].pending,false);
    bridge.busy=true;assert.equal(manager.list().items[0].pending,true);await assert.rejects(manager.close('preparing'),{code:'NATIVE_TURN_CONFLICT'});
  }finally{release?.();db.close();}
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
