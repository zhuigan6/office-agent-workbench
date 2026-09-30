import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {findCodexLauncher,findCodexBinary} from '../packages/native-sessions/codex-runtime.ts';
import {connectCodexWebSocket} from '../packages/native-sessions/codex-websocket.ts';
import {local} from '../apps/local-host/config.ts';
import os from 'node:os';

const tuiIndex=process.argv.indexOf('--tui-evidence');let previousEvidence:string|undefined,previousReport:any;
if(tuiIndex>=0){
  if(!process.stdin.isTTY||!process.stdout.isTTY)throw Error('Native TUI acceptance requires an actual terminal.');
  if(process.argv.includes('--turn')||!process.argv[tuiIndex+1])throw Error('Provide only a completed owned evidence directory for TUI resume.');
  const base=await fs.realpath(path.join(local,'verification'));previousEvidence=await fs.realpath(process.argv[tuiIndex+1]);
  const relative=path.relative(base,previousEvidence);
  if(!/^codex-remote-\d+$/.test(relative))throw Error('Only a directly owned verification directory is eligible.');
  previousReport=JSON.parse(await fs.readFile(path.join(previousEvidence,'report.json'),'utf8'));
  if(!previousReport.passed||!previousReport.sameLiveTurnObservedByBoth||!previousReport.ownedProcessStopped||!/^[-a-f0-9]{36}$/.test(previousReport.threadId??''))throw Error('Prior owned-session evidence is incomplete.');
}
const configPath=path.join(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'config.toml');
const configHash=async()=>{try{return createHash('sha256').update(await fs.readFile(configPath)).digest('hex');}catch(error){if((error as any).code==='ENOENT')return null;throw error;}};
const originalConfigHash=await configHash();

const directory=path.join(local,'verification','codex-remote-'+Date.now());await fs.mkdir(directory,{recursive:true});
const launcher=await findCodexLauncher();
const {binary}=await findCodexBinary(launcher);
const version=(await promisify(execFile)(binary,['--version'],{windowsHide:true,timeout:30000})).stdout.trim();
const reservation=createServer();await new Promise<void>(resolve=>reservation.listen(0,'127.0.0.1',resolve));
const port=(reservation.address() as any).port;await new Promise<void>(resolve=>reservation.close(()=>resolve()));
const endpoint='ws://127.0.0.1:'+port,token=randomBytes(32).toString('base64url');
const child=spawn(binary,['app-server','--listen',endpoint,'--ws-auth','capability-token','--ws-token-sha256',createHash('sha256').update(token).digest('hex')],{cwd:directory,windowsHide:true,stdio:['pipe','pipe','pipe']});
child.stdout.resume();child.stderr.resume();let childError=false;child.on('error',()=>{childError=true;});
type Connection=Awaited<ReturnType<typeof connectCodexWebSocket>>;
let owner:Connection|undefined,observer:Connection|undefined;
let tui:ReturnType<typeof spawn>|undefined;
const report:any={version,loopbackOnly:true,authentication:true,globalConfigChanged:false,userHistoryRead:false,modelRequests:0};
let threadId:string|undefined;
const observations=[{markers:new Map<string,string>(),completed:new Set<string>(),methods:new Set<string>(),terminalStatuses:[] as string[]},{markers:new Map<string,string>(),completed:new Set<string>(),methods:new Set<string>(),terminalStatuses:[] as string[]}];
try{
  const deadline=Date.now()+20000;
  while(Date.now()<deadline&&!owner&&!childError&&child.exitCode===null){try{owner=await connectCodexWebSocket(endpoint,token);}catch{await delay(200);}}
  if(!owner)throw Error('Owned authenticated server did not become ready.');
  try{const forbidden=await connectCodexWebSocket(endpoint,randomBytes(32).toString('base64url'));await forbidden.close();throw Error('Bad token unexpectedly accepted.');}catch(error){if((error as any).code!=='NATIVE_REMOTE_CONNECTION')throw error;report.badTokenRejected=true;}
  observer=await connectCodexWebSocket(endpoint,token);
  await owner.rpc.initialize();await observer.rpc.initialize();report.twoInitializedConnections=true;
  for(const connection of [owner,observer])connection.rpc.on('serverRequest',request=>connection.rpc.rejectRequest(request.id));
  if(process.argv.includes('--turn')){
    const created:any=await owner.rpc.request('thread/start',{cwd:directory,sandbox:'read-only',approvalPolicy:'on-request',experimentalRawEvents:false});
    threadId=created.thread?.id;if(typeof threadId!=='string')throw Error('Owned thread not created.');report.threadId=threadId;
    const markers=['REMOTE_OWNER_OK','REMOTE_SHARED_OBSERVER_OK'];
    for(const [index,connection] of [owner,observer].entries())connection.rpc.on('notification',(event:any)=>{
      if(event.params?.threadId!==threadId)return;
      observations[index].methods.add(event.method);
      if(event.method==='item/completed'&&event.params.item?.type==='agentMessage'&&typeof event.params.turnId==='string')for(const marker of markers)if(event.params.item.text?.trim()===marker)observations[index].markers.set(marker,event.params.turnId);
      if(event.method==='turn/completed'&&event.params.turn?.status==='completed')observations[index].completed.add(event.params.turn.id);
      if(event.method==='turn/completed')observations[index].terminalStatuses.push(String(event.params.turn?.status));
    });
    async function waitFor(marker:string,indices:number[]){
      const deadline=Date.now()+120000;
      while(Date.now()<deadline){if(indices.every(i=>{const id=observations[i].markers.get(marker);return id&&observations[i].completed.has(id);}))return;await delay(200);}
      throw Error('Shared public turn completion was not observed.');
    }
    report.modelRequests++;
    await owner.rpc.request('thread/queue/add',{threadId,clientUserMessageId:randomUUID(),input:[{type:'text',text:'Reply exactly REMOTE_OWNER_OK. Do not call tools or read files.',text_elements:[]}]});
    await waitFor(markers[0],[0]);
    const resumed:any=await observer.rpc.request('thread/resume',{threadId});
    if(resumed.thread?.id!==threadId||path.resolve(resumed.thread.cwd).toLowerCase()!==directory.toLowerCase())throw Error('Observer resumed a different thread or directory.');
    report.sameIdResumed=true;
    report.modelRequests++;
    await observer.rpc.request('thread/queue/add',{threadId,clientUserMessageId:randomUUID(),input:[{type:'text',text:'Reply exactly REMOTE_SHARED_OBSERVER_OK. Do not call tools or read files.',text_elements:[]}]});
    await waitFor(markers[1],[0,1]);
    report.sameLiveTurnObservedByBoth=true;report.threadId=threadId;
  }
  if(previousEvidence){
    if(previousReport.version!==version)throw Error('Native runtime changed since the owned evidence; validate the new version first.');
    threadId=previousReport.threadId;
    const resumed:any=await owner.rpc.request('thread/resume',{threadId,sandbox:'read-only',approvalPolicy:'on-request'});
    if(resumed.thread?.id!==threadId||path.resolve(resumed.thread.cwd).toLowerCase()!==previousEvidence.toLowerCase())throw Error('Native TUI would resume a different thread/directory.');
    if(resumed.sandbox?.type!=='readOnly')throw Error('Owned remote thread is not using the requested read-only sandbox.');
    report.remoteSandbox=resumed.sandbox.type;
    report.threadId=threadId;report.resumedOwnedEvidence=true;
    const tuiMarkers=new Map<string,string>(),done=new Set<string>();let returnedToTui=false;
    const expected=['REMOTE_TUI_CONTINUE_OK','REMOTE_WORKBENCH_TO_TUI_OK'];
    owner.rpc.on('notification',(event:any)=>{
      if(event.params?.threadId!==threadId)return;
      if(event.method==='item/completed'&&event.params.item?.type==='agentMessage')for(const marker of expected)if(event.params.item.text?.trim()===marker)tuiMarkers.set(marker,event.params.turnId);
      if(event.method==='turn/completed'&&event.params.turn?.status==='completed')done.add(event.params.turn.id);
    });
    console.log('OWNED_NATIVE_TUI: verify history; send "Reply exactly REMOTE_TUI_CONTINUE_OK. Do not use tools."; wait for the return marker, then /quit.');
    const clientHome=path.join(directory,'isolated-tui-home');await fs.mkdir(clientHome,{recursive:false});
    report.isolatedClientHome=true;
    tui=spawn(binary,['--remote',endpoint,'--remote-auth-token-env','WORKBENCH_REMOTE_TEST_TOKEN','--no-alt-screen','resume',threadId!],{cwd:previousEvidence,windowsHide:true,stdio:'inherit',env:{...process.env,CODEX_HOME:clientHome,TERM:'xterm-256color',WORKBENCH_REMOTE_TEST_TOKEN:token}});
    let tuiExited=false,tuiCode:number|null=null,tuiError=false;
    tui.once('error',()=>{tuiError=true;tuiExited=true;});tui.once('exit',code=>{tuiCode=code;tuiExited=true;});
    const until=Date.now()+600000;
    let lastProgress='',announced=false;
    while(!tuiExited&&Date.now()<until){
      const nativeTurn=tuiMarkers.get(expected[0]);
      if(!returnedToTui&&nativeTurn&&done.has(nativeTurn)){
        report.nativeTurnObserved=true;report.modelRequests++;
        returnedToTui=true;report.modelRequests++;
        await owner.rpc.request('thread/queue/add',{threadId,clientUserMessageId:randomUUID(),input:[{type:'text',text:'Reply exactly REMOTE_WORKBENCH_TO_TUI_OK. Do not use tools or read files.',text_elements:[]}]});
      }
      const back=tuiMarkers.get(expected[1]);report.returnTurnCompleted=!!back&&done.has(back);
      const progress=JSON.stringify({threadId,nativeTurnObserved:report.nativeTurnObserved===true,returnTurnCompleted:report.returnTurnCompleted,modelRequests:report.modelRequests});
      if(progress!==lastProgress){await fs.writeFile(path.join(directory,'tui-progress.json'),progress);lastProgress=progress;}
      if(report.returnTurnCompleted&&!announced){announced=true;console.log('OWNED_TUI_ROUNDTRIP_COMPLETE: both replies observed; exit this test terminal with /quit.');}
      await delay(200);
    }
    if(!tuiExited){tui.kill();throw Error('Owned native TUI acceptance timed out.');}
    report.nativeTuiExitedCleanly=!tuiError&&tuiCode===0;
    const returnTurn=tuiMarkers.get(expected[1]);report.returnTurnCompleted=!!returnTurn&&done.has(returnTurn);
    if(!report.nativeTuiExitedCleanly||!report.nativeTurnObserved||!report.returnTurnCompleted)throw Error('Native terminal roundtrip acceptance is incomplete.');
    report.nativeTuiTested=true;
  }
  report.passed=true;report.nativeTuiTested??=false;report.documentToolsTested=false;
}catch(error){
  report.error=error instanceof Error?error.message:'Remote acceptance failed.';
  if(threadId&&observer){try{const own:any=await observer.rpc.request('thread/read',{threadId,includeTurns:true});report.ownedHistory={sameId:own.thread?.id===threadId,status:own.thread?.status?.type,turnStatuses:own.thread?.turns?.map((t:any)=>t.status),observerReplyStored:own.thread?.turns?.some((t:any)=>t.items?.some((item:any)=>item.type==='agentMessage'&&item.text?.trim()==='REMOTE_SHARED_OBSERVER_OK'))};}catch{report.ownedHistoryReadFailed=true;}}
  process.exitCode=1;
}
finally{
  if(tui&&tui.exitCode===null&&tui.signalCode===null)tui.kill();
  report.observations=observations.map(o=>({markers:[...o.markers.keys()],completedCount:o.completed.size,methods:[...o.methods],terminalStatuses:o.terminalStatuses}));
  await observer?.close();await owner?.close();child.stdin.end();
  if(child.exitCode===null&&child.signalCode===null){child.kill();await new Promise<void>(resolve=>{const timer=setTimeout(resolve,5000);child.once('exit',()=>{clearTimeout(timer);resolve();});});}
  report.ownedProcessStopped=child.exitCode!==null||child.signalCode!==null;
  report.globalConfigChanged=(await configHash())!==originalConfigHash;
  if(report.globalConfigChanged)process.exitCode=1;
  if(!report.ownedProcessStopped)process.exitCode=1;
  await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,evidence:directory}));
}
