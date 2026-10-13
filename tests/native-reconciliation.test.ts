import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {NativeSessionStore} from '../packages/native-sessions/store.ts';
import {planCodexReconciliation} from '../packages/native-sessions/reconciliation.ts';
import {NativeSessions} from '../packages/native-sessions/manager.ts';

const principal='local-workbench-user',owner={ownerId:'worker',launchId:'launch',ownerEpoch:1};
const source={vendor:'codex' as const,vendorSessionId:'original'};
function fixture(){
  const db=new DatabaseSync(':memory:'),store=new NativeSessionStore(db);
  store.link(principal,{...source,linkId:'link',threadId:'link',workingDirectory:process.cwd(),ownerLink:{principalId:principal},capabilities:{publicEvents:true,sendUserMessages:true,toolEvents:true}});
  store.acquire('link',principal,0,owner.ownerId,owner.launchId,60000);
  store.enqueue('link',principal,{messageId:'m1',text:'fixed message'});store.beginDispatch('link',principal,owner,source,'m1');
  store.appendEvent('link',principal,owner,{...source,vendorEventId:'active',kind:'turn.started',turnId:'turn'});
  store.appendEvent('link',principal,owner,{...source,vendorEventId:'lost',kind:'owner.status',status:'uncertain'});
  const response={thread:{id:source.vendorSessionId,cwd:process.cwd(),status:{type:'notLoaded'},turns:[{id:'turn',status:'completed',itemsView:'full',items:[{id:'user',type:'userMessage',clientId:'m1',content:[{type:'text',text:'fixed message'}]},{id:'reason',type:'reasoning',summary:['private']},{id:'answer',type:'agentMessage',text:'public answer'}]}]}};
  return {db,store,response,link:()=>store.get('link',principal),messages:()=>store.pendingMessages('link',principal)};
}
test('offline reconciliation confirms exact message ID, preserves public history and never fabricates a queue receipt',()=>{
  const f=fixture();try{
    const old=f.link(),messages=f.messages(),plan=planCodexReconciliation(old,messages,f.response);assert.equal(plan.ready,true);assert.deepEqual(plan.outcomes,[{messageId:'m1',turnId:'turn',state:'completed'}]);
    f.store.reconcileOffline('link',principal,old,messages,plan);const link=f.link();assert.equal(link.vendorSessionId,'original');assert.equal(link.owner,null);assert.equal(link.activeTurnId,null);
    assert.equal(f.store.message('link',principal,'m1').state,'completed');assert.equal(f.store.message('link',principal,'m1').vendorRequestId,null);assert.equal(f.store.hasPending('link',principal),false);
    const events=f.store.replay('link',principal).items;assert.ok(events.some(e=>e.event.kind==='assistant.text'));assert.ok(!JSON.stringify(events).includes('private'));
    assert.equal(f.store.enqueue('link',principal,{messageId:'m1',text:'fixed message'}).state,'completed');
  }finally{f.db.close();}
});
test('vendor interruption is terminal but is not a successful completion',()=>{
  const f=fixture();try{
    f.response.thread.turns[0].status='interrupted';const link=f.link(),messages=f.messages(),plan=planCodexReconciliation(link,messages,f.response);
    f.store.reconcileOffline('link',principal,link,messages,plan);assert.equal(f.store.message('link',principal,'m1').state,'interrupted');assert.equal(f.store.hasPending('link',principal),false);
    const acquired=f.store.acquire('link',principal,f.link().ownerEpoch,'new','next',60000);
    assert.throws(()=>f.store.beginDispatch('link',principal,{ownerId:acquired.owner!.ownerId,launchId:acquired.owner!.launchId,ownerEpoch:acquired.ownerEpoch},source,'m1'),{code:'NATIVE_DISPATCH_UNCERTAIN'});
  }finally{f.db.close();}
});
test('missing IDs, wrong text, partial or unfinished turns never unlock or resend unknown requests',()=>{
  const f=fixture();try{
    for(const mutate of [(r:any)=>r.thread.turns[0].items[0].clientId=null,(r:any)=>r.thread.turns[0].items[0].content[0].text='other',(r:any)=>r.thread.turns[0].status='inProgress',(r:any)=>r.thread.turns[0].itemsView='summary',(r:any)=>r.thread.turns=[]]){
      const response=structuredClone(f.response);mutate(response);const plan=planCodexReconciliation(f.link(),f.messages(),response);assert.equal(plan.ready,false);assert.equal(f.store.message('link',principal,'m1').state,'unknown');
    }
    assert.throws(()=>planCodexReconciliation(f.link(),f.messages(),{thread:{...f.response.thread,id:'fork'}}),{code:'NATIVE_SOURCE_MISMATCH'});
    assert.throws(()=>planCodexReconciliation(f.link(),f.messages(),{thread:{...f.response.thread,cwd:process.cwd()+'/different'}}),{code:'NATIVE_SOURCE_MISMATCH'});
  }finally{f.db.close();}
});
test('reconciliation transaction refuses changed owner/state and rolls back conflicting public evidence',()=>{
  const f=fixture();try{
    const old=f.link(),messages=f.messages(),plan=planCodexReconciliation(old,messages,f.response);
    f.store.release('link',principal,owner);assert.throws(()=>f.store.reconcileOffline('link',principal,old,messages,plan),{code:'NATIVE_STATE_CONFLICT'});
    assert.equal(f.store.message('link',principal,'m1').state,'unknown');
  }finally{f.db.close();}
  const g=fixture();try{
    const old=g.link(),messages=g.messages(),plan=planCodexReconciliation(old,messages,g.response);
    const event=plan.events.find(e=>e.kind==='assistant.text')!;
    g.db.prepare('INSERT INTO native_session_events(link,vendor,session,event_id,body) VALUES(?,?,?,?,?)').run('link','codex','original',event.vendorEventId,'different');
    assert.throws(()=>g.store.reconcileOffline('link',principal,old,messages,plan),{code:'NATIVE_ID_REUSED'});assert.equal(g.store.message('link',principal,'m1').state,'unknown');assert.notEqual(g.link().owner,null);
  }finally{g.db.close();}
});
test('manager refuses living prior processes and unresolved document writes before any vendor lookup',async()=>{
  const f=fixture();try{
    const manager=new NativeSessions(f.db,'unused',()=>{});
    f.db.prepare('INSERT INTO native_session_metadata VALUES(?,?,?)').run('link','kept',JSON.stringify({execution:{hostPid:process.pid,serverPid:process.pid,launchId:owner.launchId,ownerEpoch:owner.ownerEpoch}}));
    await assert.rejects(manager.reconcile('link'),{code:'NATIVE_OWNER_UNCERTAIN'});
    await assert.rejects(manager.reconcile('link',['unknown-document-operation']),{code:'NATIVE_DOCUMENT_UNCERTAIN'});assert.equal(f.store.message('link',principal,'m1').state,'unknown');
  }finally{f.db.close();}
});
test('cancel targets only the current turn, denies pending approvals and waits for an executing document tool',async()=>{
  const f=fixture();try{
    f.store.release('link',principal,owner);f.store.acquire('link',principal,f.link().ownerEpoch,'next','next-launch',60000);
    const manager=new NativeSessions(f.db,'unused',()=>{}),calls:any[]=[],denied:string[]=[];
    const bridge={running:true,pending:()=>[{callId:'unapproved'}],cancel:(id:string)=>denied.push(id)};
    (manager as any).runtimes.set('link',{bridge,cancellationShape:true,owner:{ownerId:'next',launchId:'next-launch',ownerEpoch:f.link().ownerEpoch},rpc:{request:async(method:string,args:unknown)=>{calls.push({method,args});return method==='thread/read'?{thread:{...f.response.thread,status:{type:'idle'},turns:[{id:'turn',status:'interrupted',items:[]}]}}:method==='thread/queue/list'?{data:[],nextCursor:null}:{};}}});
    await assert.rejects(manager.interrupt('link'),{code:'NATIVE_DOCUMENT_BUSY'});assert.equal(calls.length,0);assert.equal(denied.length,0);
    bridge.running=false;const result=await manager.interrupt('link');assert.equal(result.documentRollback,false);assert.deepEqual(denied,['unapproved']);assert.deepEqual(calls[0],{method:'turn/interrupt',args:{threadId:'original',turnId:'turn'}});
    assert.equal(f.store.message('link',principal,'m1').state,'unknown');
  }finally{f.db.close();}
});
test('retiring a known fenced child preserves uncertain receipts and requires separate reconciliation',async()=>{
  const f=fixture();let timer:ReturnType<typeof setInterval>|undefined;try{
    const manager=new NativeSessions(f.db,'unused',()=>{});let stops=0,closed=0;
    timer=setInterval(()=>{},60000);const child={exitCode:null as number|null,signalCode:null},runtime={owner,bridge:{running:false,provider:{document:{documentId:'doc'}},close:async()=>{closed++;}},timer,session:{disconnect:()=>{}},server:{child,stop:async()=>{stops++;child.exitCode=0;}}};
    (manager as any).runtimes.set('link',runtime);assert.equal(manager.list().items[0].connected,false);assert.equal(manager.list().items[0].canRetire,true);
    const result=await manager.retireUncertain('link');assert.equal(result.retired,true);assert.equal(stops,1);assert.equal(closed,1);
    assert.equal(f.store.message('link',principal,'m1').state,'unknown');assert.notEqual(f.link().owner,null);assert.equal(manager.list().items[0].canResume,false);assert.equal(f.link().vendorSessionId,'original');
  }finally{if(timer)clearInterval(timer);f.db.close();}
});
test('uncertain owners cannot approve old writes and retirement refuses in-flight or foreign ownership',async()=>{
  const f=fixture();let timer:ReturnType<typeof setInterval>|undefined;try{
    const manager=new NativeSessions(f.db,'unused',()=>{});let approvals=0,stops=0;
    timer=setInterval(()=>{},60000);const runtime={owner,bridge:{running:true,confirm:async()=>{approvals++;return {};},close:async()=>{}},timer,session:{disconnect:()=>{}},server:{child:{exitCode:0,signalCode:null},stop:async()=>{stops++;}}};
    (manager as any).runtimes.set('link',runtime);
    await assert.rejects(manager.confirm('link',{callId:'old',allow:true}),{code:'NATIVE_OWNER_UNCERTAIN'});assert.equal(approvals,0);
    await manager.confirm('link',{callId:'old',allow:false});assert.equal(approvals,1);
    await assert.rejects(manager.retireUncertain('link'),{code:'NATIVE_DOCUMENT_UNCERTAIN'});runtime.bridge.running=false;
    await assert.rejects(manager.retireUncertain('link',['unknown-restore']),{code:'NATIVE_DOCUMENT_UNCERTAIN'});
    runtime.owner={...owner,launchId:'other'};await assert.rejects(manager.retireUncertain('link'),{code:'NATIVE_OWNER_UNCERTAIN'});assert.equal(stops,0);
  }finally{if(timer)clearInterval(timer);f.db.close();}
});
