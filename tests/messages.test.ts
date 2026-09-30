import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../packages/document-workspace/store.ts';
import {MessageDispatcher} from '../packages/document-workspace/messages.ts';
import {sendIntent,acknowledgeIntent} from '../apps/workbench/src/send-intent.ts';

test('accepted sends replay receipts and reject different content',async()=>{
  const store=new Store(':memory:');
  try {
    const dispatcher=new MessageDispatcher(store);let calls=0;
    const prepare=async()=>async()=>{calls++;return {turnId:'turn',messageId:'message'};};
    const first=await dispatcher.send('chat','request-1',{content:'hello'},prepare);
    assert.deepEqual(await dispatcher.send('chat','request-1',{content:'hello'},prepare),first);
    await assert.rejects(dispatcher.send('chat','request-1',{content:'changed'},prepare),{code:'ID_REUSED'});
    assert.equal(calls,1);
  }finally{store.close();}
});
test('fast completion cannot resurrect a finished turn and delayed events cannot clear a newer turn',async()=>{
  const store=new Store(':memory:');
  try{
    store.linkConversation('chat','',{});const d=new MessageDispatcher(store);
    await d.send('chat','request-fast',{},async()=>async()=>{d.completed('chat','fast');return {turnId:'fast',messageId:'message'};});
    assert.equal(store.conversations()[0].turn,null);
    store.turn('chat','new');d.completed('chat','old');assert.equal(store.conversations()[0].turn,'new');
    d.completed('chat','new');assert.equal(store.conversations()[0].turn,null);
  }finally{store.close();}
});
test('concurrent windows cannot race preparation, but other chats can submit',async()=>{
  const store=new Store(':memory:');
  try {
    const dispatcher=new MessageDispatcher(store);
    let release!:()=>void;const pause=new Promise<void>(r=>{release=r;});
    const prepare=async()=>{await pause;return async()=>({turnId:'t',messageId:'m'});};
    const first=dispatcher.send('chat','request-1',{},prepare);
    assert.equal(dispatcher.busy,true);
    await assert.rejects(dispatcher.send('chat','request-2',{},prepare),{code:'CONVERSATION_BUSY'});
    const second=dispatcher.send('other','request-2',{},prepare);
    release();await Promise.all([first,second]);assert.equal(dispatcher.busy,false);
  }finally{store.close();}
});
test('ambiguous dispatch never retries, including after process recovery',async()=>{
  const store=new Store(':memory:');
  try {
    let dispatcher=new MessageDispatcher(store),calls=0;
    const prepare=async()=>async()=>{calls++;throw Error('timeout');};
    await assert.rejects(dispatcher.send('chat','request-1',{},prepare),{code:'SEND_UNKNOWN'});
    dispatcher=new MessageDispatcher(store);
    await assert.rejects(dispatcher.send('chat','request-1',{},prepare),{code:'SEND_UNKNOWN'});
    assert.equal(calls,1);
    store.db.prepare('INSERT INTO message_requests VALUES(?,?,?,?,NULL)').run('chat','request-2','hash','dispatching');
    new MessageDispatcher(store);
    assert.equal((store.db.prepare('SELECT state FROM message_requests WHERE request=?').get('request-2') as any).state,'unknown');
  }finally{store.close();}
});
test('preflight failure and invalid IDs do not dispatch or poison subsequent sends',async()=>{
  const store=new Store(':memory:');
  try {
    const d=new MessageDispatcher(store),good=async()=>async()=>({turnId:'t',messageId:'m'});
    await assert.rejects(d.send('c',undefined as any,{},good),{code:'INVALID_REQUEST_ID'});
    await assert.rejects(d.send('c','request-1',{},async()=>{throw Error('busy');}),/busy/);
    assert.deepEqual(await d.send('c','request-1',{},good),{turnId:'t',messageId:'m'});
  }finally{store.close();}
});
test('browser retry IDs survive refresh and isolate tasks and changed content',()=>{
  let value='';const storage={getItem:()=>value,setItem:(_key:string,v:string)=>{value=v;}};
  assert.equal(sendIntent(storage,'c',{text:'a'},()=> 'id-1'),'id-1');
  assert.equal(sendIntent(storage,'c',{text:'a'},()=> 'id-2'),'id-1');
  assert.equal(sendIntent(storage,'d',{text:'a'},()=> 'id-2'),'id-2');
  assert.equal(sendIntent(storage,'c',{text:'b'},()=> 'id-3'),'id-3');
  acknowledgeIntent(storage,'c','id-1');
  assert.equal(sendIntent(storage,'c',{text:'b'},()=> 'wrong'),'id-3');
  acknowledgeIntent(storage,'c','id-3');
  assert.equal(sendIntent(storage,'c',{text:'b'},()=> 'id-4'),'id-4');
});
