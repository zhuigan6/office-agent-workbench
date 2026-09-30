import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,X509Certificate} from 'node:crypto';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {httpsTransport} from '../packages/client/index.ts';
import {loadConfig,root,local} from '../apps/local-host/config.ts';

const config=loadConfig(),ca=new X509Certificate(await fs.readFile(path.join(local,'server.cer'))).toString();
const directory=path.join(local,'verification','live-tools-'+Date.now());await fs.mkdir(directory,{recursive:true});
const report:any={checks:[],modelRequests:0,documentSaveIssued:false};
async function api(method:'GET'|'POST',route:string,data?:unknown){
  const body=data===undefined?undefined:Buffer.from(JSON.stringify(data));
  const response=await httpsTransport({url:new URL(route,`https://localhost:${config.port}`),method,ca,timeoutMs:90000,headers:{Authorization:'Bearer '+config.uiToken,...(body?{'Content-Type':'application/json'}:{})},body});
  if(response.status<200||response.status>=300)throw Error('Verification API rejected request: '+response.status);
  return JSON.parse(response.body.toString());
}
const filename=path.resolve(local,'host-fixtures','native-word-test.docx');
const hash=async()=>createHash('sha256').update(await fs.readFile(filename)).digest('hex');
let client:Client|undefined;const pending:string[]=[];
try{
  const docs=await api('GET','/api/native/documents');
  const matches=docs.documents.filter((d:any)=>path.resolve(d.location).toLowerCase()===filename.toLowerCase());
  assert.equal(matches.length,1,'Only one open dedicated Word fixture is eligible.');
  const binding=await api('POST','/api/native/bind',{id:matches[0].id});
  const tasks=await api('GET','/api/conversations'),name='Unified Word tools acceptance';
  const task=tasks.find((t:any)=>t.name===name&&t.documentId===binding.documentId)??await api('POST','/api/conversations',{name,documentId:binding.documentId});
  const grant=await api('POST',`/api/conversations/${task.id}/access`,{}),env=grant.mcpServers['office-workbench'].env;
  const inherited=Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>typeof entry[1]==='string'));
  async function connect(surface:string){
    const c=new Client({name:'workbench-verification',version:'1.0.0'});
    await c.connect(new StdioClientTransport({command:process.execPath,args:['--import',pathToFileURL(path.join(root,'node_modules/tsx/dist/loader.mjs')).href,path.join(root,'apps/local-host/mcp.ts')],cwd:root,env:{...inherited,...env,WORKBENCH_TOOL_SURFACE:surface},stderr:'ignore'}));
    return c;
  }
  client=await connect('compact');
  const compact=await client.listTools();assert.deepEqual(compact.tools.map(t=>t.name).sort(),['office_file','office_live']);
  report.compactToolCount=compact.tools.length;report.compactSchemaBytes=Buffer.byteLength(JSON.stringify(compact));
  const legacy=await connect('legacy');
  try{const list=await legacy.listTools();assert.ok(list.tools.some(t=>t.name==='office_format_selection'));report.legacyToolCount=list.tools.length;report.legacySchemaBytes=Buffer.byteLength(JSON.stringify(list));}finally{await legacy.close();}
  async function live(input:Record<string,unknown>){
    const result:any=await client!.callTool({name:'office_live',arguments:input});
    if(result.isError)throw Error(result.content?.[0]?.text??'Live tool failed.');
    return JSON.parse(result.content[0].text);
  }
  const help=await live({action:'help',operation:'format-selection'});assert.equal(help.example.params.paragraph.alignment,'center');
  const originalHash=await hash(),before=await live({action:'execute',operation:'read-text',params:{count:10}});
  assert.deepEqual(before.items.map((i:any)=>i.text),['Native Word original','Keep this paragraph unchanged']);
  const target=await live({action:'execute',operation:'target',params:{kind:'word',text:'Native Word original'}});assert.equal(target.status,'resolved');
  const requestedId='compact_paragraph_'+Date.now();
  const replacementId='compact_replace_'+Date.now(),replacementText='Native Word improved and formatted';
  const replaceRequest={action:'execute',operation:'replace-selection',params:{selectionId:target.selectionId,operationId:replacementId,text:replacementText}};
  await fs.writeFile(path.join(directory,'pending.json'),JSON.stringify({requestedIds:[replacementId,requestedId],conversation:task.id}));
  const replaced=await live(replaceRequest);
  assert.equal(replaced.status,'applied');pending.push(replaced.operationId);assert.equal(replaced.selectionReference.status,'advanced');
  await fs.writeFile(path.join(directory,'pending.json'),JSON.stringify({operations:pending,requestedIds:[replacementId,requestedId],conversation:task.id}));
  const changed=await live({action:'execute',operation:'format-selection',params:{selectionId:target.selectionId,operationId:requestedId,paragraph:{alignment:'center',spaceAfter:12}}});
  assert.equal(changed.status,'applied');assert.equal(changed.verified,true);pending.push(changed.operationId);assert.equal(changed.selectionReference.status,'advanced');
  await fs.writeFile(path.join(directory,'pending.json'),JSON.stringify({operations:pending,requestedIds:[replacementId,requestedId],conversation:task.id}));
  const replay=await live(replaceRequest);assert.equal(replay.operationId,replaced.operationId);assert.equal(replay.selectionReference.status,'already-applied');assert.equal(replay.selectionReference.revision,changed.revision);
  const op=await api('GET','/api/operations');
  const record=op.find((r:any)=>r.id===changed.operationId);assert.equal(record.result.after.paragraphs[0].format.alignment,1);assert.equal(record.result.after.paragraphs[0].format.spaceAfter,12);
  assert.equal(record.payload.selection.end,replacementText.length);
  const after=await live({action:'execute',operation:'read-text',params:{count:10}});assert.deepEqual(after.items.map((i:any)=>i.text),[replacementText,before.items[1].text]);assert.ok(before.items[1].semanticHash);assert.equal(after.items[1].semanticHash,before.items[1].semanticHash);
  while(pending.length){const restored=await api('POST','/api/restore',{operationId:pending.at(-1)});assert.equal(restored.status,'applied');pending.pop();}
  const final=await live({action:'execute',operation:'read-text',params:{count:10}});assert.deepEqual(final.items,before.items);assert.equal(await hash(),originalHash);
  report.checks.push('compact and legacy tool discovery','on-demand operation help','same frozen reference: text replacement followed by paragraph formatting','older request replay does not regress the reference or repeat text replacement','native property readback and unselected neighbor preservation','reverse guarded recovery to exact original readback','original disk hash unchanged');report.passed=true;
}catch(error){report.error=error instanceof Error?error.message:'MCP verification failed.';if(error instanceof Error)report.failureLocation=error.stack?.match(/Verify-LiveTools\.ts:\d+:\d+/)?.[0];process.exitCode=1;}
finally{
  while(pending.length){try{const restored=await api('POST','/api/restore',{operationId:pending.at(-1)});if(restored.status!=='applied')throw Error('Recovery did not verify');pending.pop();report.cleanupRestored=true;}catch{report.cleanupRestored=false;report.pendingOperations=[...pending];break;}}
  await client?.close();await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,evidence:directory}));
}
