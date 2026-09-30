import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,X509Certificate} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {httpsTransport} from '../packages/client/index.ts';
import {loadConfig,local} from '../apps/local-host/config.ts';

// One read-only model turn in the dedicated fixture task; not a general runner.
const config=loadConfig(),ca=new X509Certificate(await fs.readFile(path.join(local,'server.cer'))).toString();
const directory=path.join(local,'verification','managed-live-tools-'+Date.now());await fs.mkdir(directory,{recursive:true});
const report:any={modelRequests:0,documentWrites:0,permanentPermissions:false};
async function api(method:'GET'|'POST',route:string,data?:unknown){
  const body=data===undefined?undefined:Buffer.from(JSON.stringify(data));
  const response=await httpsTransport({url:new URL(route,`https://localhost:${config.port}`),method,ca,timeoutMs:90000,headers:{Authorization:'Bearer '+config.uiToken,...(body?{'Content-Type':'application/json'}:{})},body});
  if(response.status<200||response.status>=300)throw Error('Acceptance API rejected request: '+response.status);
  return JSON.parse(response.body.toString());
}
let conversation:string|undefined,finished=false;
try{
  const tasks=await api('GET','/api/conversations'),task=tasks.find((t:any)=>t.name==='Unified Word tools acceptance');
  if(!task)throw Error('Run Verify-LiveTools.ts first; no user conversation is eligible.');
  conversation=task.id;
  const state=await api('GET',`/api/conversations/${conversation}/state`);
  if(state.runtime?.state!=='idle')throw Error('Dedicated acceptance task is busy.');
  const marker='LIVE_HELP_OK_'+Date.now();
  report.modelRequests=1;
  await api('POST',`/api/conversations/${conversation}/messages`,{requestId:randomUUID(),content:`Read-only integration acceptance: call office_live with action help and operation format-selection. Do not edit, write, replace, execute commands, or use any other tool. After receiving paragraph-format help, reply exactly ${marker}.`});
  let approved=0;
  const deadline=Date.now()+120000;
  while(Date.now()<deadline){
    const pending=await api('GET',`/api/conversations/${conversation}/confirmations`);
    for(const item of pending){
      if(approved||item.command_type!=='mcp'||item.action!=='office_live'||!item.canAllow||!item.msg_id)throw Error('Unexpected or unmapped approval; no automatic consent granted.');
      const prefix='MCP office-workbench/office_live: ';
      if(typeof item.description!=='string'||!item.description.startsWith(prefix))throw Error('Unknown tool approval description.');
      const args=JSON.parse(item.description.slice(prefix.length));
      if(Object.keys(args).length!==2||args.action!=='help'||args.operation!=='format-selection')throw Error('Only the exact read-only help request may be approved.');
      // A mismatched message identity must be rejected without consuming approval.
      const rejected=await httpsTransport({url:new URL(`/api/conversations/${conversation}/confirm`,`https://localhost:${config.port}`),method:'POST',ca,timeoutMs:90000,headers:{Authorization:'Bearer '+config.uiToken,'Content-Type':'application/json'},body:Buffer.from(JSON.stringify({callId:item.call_id,msgId:'wrong-message-identity',allow:true}))});
      if(rejected.status!==409)throw Error('Wrong approval identity was not refused.');
      await api('POST',`/api/conversations/${conversation}/confirm`,{callId:item.call_id,msgId:item.msg_id,allow:true});approved++;
      report.mappedApproval=true;report.wrongApprovalIdentityRejected=true;
    }
    const current=await api('GET',`/api/conversations/${conversation}/state`);
    if(current.runtime?.state==='idle'){
      const history=await api('GET',`/api/conversations/${conversation}/messages`);
      if(!history.items.some((m:any)=>m.position==='left'&&m.type==='text'&&JSON.stringify(m.content).includes(marker)))throw Error('Model did not acknowledge this specific help request.');
      if(!history.items.some((m:any)=>m.type==='tool_call'&&m.content?.name==='office_live'&&JSON.stringify(m.content).includes('firstLineIndent')))throw Error('Managed tool-result evidence missing.');
      finished=true;report.passed=true;report.oneTimeApprovals=approved;report.conversation=conversation;break;
    }
    await delay(1000);
  }
  if(!finished)throw Error('Read-only managed model probe timed out.');
}catch(error){report.error=error instanceof Error?error.message:'Managed acceptance failed.';process.exitCode=1;}
finally{
  if(conversation&&report.modelRequests&&!finished){try{await api('POST',`/api/conversations/${conversation}/cancel`,{});report.cancelRequested=true;}catch{report.inspectPendingTask=true;}}
  await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,evidence:directory}));
}
