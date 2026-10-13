import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {NativeSessions} from '../packages/native-sessions/manager.ts';
test('after cancellation, explicit new input starts its verified queue item once and never drains other pending input',async()=>{
  for(const foreign of [false,true]){
    const db=new DatabaseSync(':memory:');try{
      const manager=new NativeSessions(db,'unused',()=>{}),principal='local-workbench-user',calls:any[]=[];
      manager.store.link(principal,{linkId:'new',threadId:'new',vendor:'codex',vendorSessionId:'original',workingDirectory:process.cwd(),ownerLink:{principalId:principal},capabilities:{publicEvents:true,sendUserMessages:true,toolEvents:true}});
      const runtime={queuePaused:true,session:{send:async()=>({state:'accepted',vendorRequestId:'q1'})},rpc:{request:async(method:string,params:unknown)=>{calls.push({method,params});return {data:[{id:'q1',clientUserMessageId:'m1',input:[{type:'text',text:'new input'}]},...(foreign?[{id:'older',clientUserMessageId:'other',input:[]}]:[])],nextCursor:null};}}};
      (manager as any).runtimes.set('new',runtime);
      const message={messageId:'m1',text:'new input'};
      if(foreign){await assert.rejects(manager.send('new',message),{code:'NATIVE_DISPATCH_UNCERTAIN'});assert.equal(runtime.queuePaused,true);assert.equal(calls.length,1);}
      else{await manager.send('new',message);assert.equal(runtime.queuePaused,false);assert.deepEqual(calls[1],{method:'thread/queue/start',params:{threadId:'original',queuedSubmissionId:'q1'}});await manager.send('new',message);assert.equal(calls.length,2);}
    }finally{db.close();}
  }
});
