import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes, randomUUID, timingSafeEqual, X509Certificate } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AppError, canonical, rangeRequestSchema, type DocumentBinding } from '../../packages/contracts/index.ts';
import { writeToolResult } from '../../packages/contracts/tool-results.ts';
import {hostTextReadSchema} from '../../packages/contracts/host-text.ts';
import { Store,digest,revision } from '../../packages/document-workspace/store.ts';
import { MessageDispatcher } from '../../packages/document-workspace/messages.ts';
import {SelectionTickets,captureBoundSelection,writeExcelSelection} from '../../packages/document-workspace/selections.ts';
import {SelectionGuard} from '../../packages/document-workspace/selection-guard.ts';
import {formatWordSelection} from '../../packages/document-workspace/word-format.ts';
import {planLiveRequest} from '../../packages/contracts/live-tools.ts';
import {formatPptSelection} from '../../packages/document-workspace/ppt-format.ts';
import {layoutPptSelection} from '../../packages/document-workspace/ppt-layout.ts';
import {replaceWordSelection} from '../../packages/document-workspace/word-replace.ts';
import {replacePptSelection} from '../../packages/document-workspace/ppt-replace.ts';
import {Archives} from '../../packages/document-workspace/archives.ts';
import {reportedUsage} from '../../packages/contracts/usage.ts';
import {restoreOperation} from '../../packages/document-workspace/recovery.ts';
import {approvalChoice,normalizedApproval} from '../../packages/contracts/approval.ts';
import {fileToolResult} from '../../packages/contracts/file-results.ts';
import {FileBatchError} from '../../packages/contracts/file-batch.ts';
import {syncTaskFileRefs} from '../../packages/document-workspace/file-delivery.ts';
import {questionAnswer} from '../../packages/contracts/questions.ts';
import {certificateMaintenance} from '../../packages/contracts/maintenance.ts';
import {agentOptions,validateAgentOption,observedAgentOption} from '../../packages/contracts/agent-options.ts';
import { DocumentBroker, type Host } from '../../packages/document-workspace/broker.ts';
import { OfficeCli } from '../../packages/officecli-adapter/index.ts';
import { AionCore } from '../../packages/aioncore-adapter/index.ts';
import { catalog, addProvider } from '../../packages/aioncore-adapter/catalog.ts';
import {ManagedPermissionDetails} from '../../packages/aioncore-adapter/permission-details.ts';
import {managedDocumentInstructions} from '../../packages/native-sessions/document-context.ts';
import { FileWorkspace } from '../../packages/document-workspace/files.ts';
import { NativeOffice } from '../../packages/native-office/index.ts';
import { NativeSessions } from '../../packages/native-sessions/manager.ts';
import {nativeOperationsForStore,nativeOperationPage,assertNativeOperationForStore,unresolvedNativeOperationsForStore} from '../../packages/native-sessions/operations.ts';
import {layoutPptBatch} from '../../packages/document-workspace/ppt-layout-batch.ts';
import {editWordTableBatch,wordTableReferenceSchema} from '../../packages/document-workspace/word-table-batch.ts';
import {layoutWordTable} from '../../packages/document-workspace/word-table-layout.ts';
import {replaceWordParagraphBatch} from '../../packages/document-workspace/word-paragraph-batch.ts';
import {appendWordTableRows} from '../../packages/document-workspace/word-table-rows.ts';
import {frozenSelectionContext} from '../../packages/contracts/selection-context.ts';
import {mutateSelectedTable} from '../../packages/document-workspace/table-selection.ts';
import {excelTablesReadSchema,excelSheetsReadSchema} from '../../packages/contracts/excel-table.ts';
import {styleExcelTable,appendExcelTable,appendExcelColumns} from '../../packages/document-workspace/excel-table.ts';
import {excelChartsReadSchema} from '../../packages/contracts/excel-chart.ts';
import {layoutExcelChart,createExcelChart} from '../../packages/document-workspace/excel-chart.ts';
import {formatExcelRange} from '../../packages/document-workspace/excel-range-format.ts';
import {createExcelTable} from '../../packages/document-workspace/excel-table-create.ts';
import {connectDocumentTools,type NativeToolProvider} from '../../packages/native-sessions/document-tools.ts';
import { loadConfig, root, local } from './config.ts';

const config=loadConfig(), origin=`https://localhost:${config.port}`;
const certificateValidTo=Date.parse(new X509Certificate(fs.readFileSync(path.join(local,'server.cer'))).validTo);
fs.mkdirSync(local,{recursive:true});
const store=new Store(path.join(local,'documents.db'));
const messages=new MessageDispatcher(store);
const selections=new SelectionTickets();
const selectionGuard=new SelectionGuard(store.db);
const archives=new Archives(store.db);
const optionUpdates=new Set<string>();
const broker=new DocumentBroker(store);
const upstreamLock=JSON.parse(fs.readFileSync(path.join(root,'upstreams.lock.json'),'utf8'));
const engine=new OfficeCli(config.officecli,path.join(local,'artifacts'),upstreamLock.officecli.binarySha256);
const files=new FileWorkspace(store,path.join(local,'files'),engine);
const nativeOffice=new NativeOffice(root,local);
let nativeError:string|null=null;
let nativeRefreshing=false;
const nativeTimer=setInterval(async()=>{
  if(nativeRefreshing||!store.documents().some(d=>d.documentId.startsWith('native:')))return;
  nativeRefreshing=true;
  try{await nativeOffice.refreshBound(broker);nativeError=null;}catch(e){nativeError=e instanceof Error?e.message:String(e);}finally{nativeRefreshing=false;}
},10000);nativeTimer.unref();
const viewers=new Set<WebSocket>();
function filesChanged(conversation?:string){for(const client of viewers)if(client.readyState===WebSocket.OPEN)client.send(JSON.stringify({type:'files.changed',conversation:conversation??null}));}
const nativeProxyGrants=new Map<string,{scope:string;provider:NativeToolProvider}>();
const nativeSessions=new NativeSessions(store.db,local,link=>{
  for(const client of viewers)if(client.readyState===WebSocket.OPEN)client.send(JSON.stringify({type:'native.event',linkId:link}));
  setTimeout(()=>{if(!coreReady&&!stopping&&!nativeSessions.busy)void shutdown(1);},0).unref();
},async(scopeId,taskId)=>{
  const task=knownConversation(taskId);
  const prior=store.db.prepare('SELECT runtime FROM native_session_metadata WHERE link=?').get(scopeId) as any;
  const original=prior?JSON.parse(prior.runtime).document:null;
  if(original&&(original.taskId!==taskId||original.documentId!==(task.doc||'')))throw new AppError('NATIVE_SOURCE_MISMATCH','Original task/document binding changed; files were not relinked.',409);
  const grant=randomBytes(32).toString('base64url'),proxyToken=randomBytes(32).toString('base64url');store.addGrant(grant,task.doc||'',scopeId);
  syncTaskFileRefs(files,taskId,scopeId);
  const provider=await connectDocumentTools({taskId,documentId:task.doc||'',name:task.body.name||'Document task'},process.execPath,
    ['--import',pathToFileURL(path.join(root,'node_modules/tsx/dist/loader.mjs')).href,path.join(root,'apps/local-host/mcp.ts')],
    {WORKBENCH_URL:origin,WORKBENCH_TOOL_TOKEN:grant,WORKBENCH_CA:path.join(local,'server.cer')},()=>{store.revokeGrant(grant);nativeProxyGrants.delete(digest(proxyToken));});
  nativeProxyGrants.set(digest(proxyToken),{scope:scopeId,provider});
  // A new process must not revive an earlier selected-message ticket.
  selectionGuard.set(scopeId);
  const prefix='mcp_servers.workbench-native-docs';
  const proxyArgs=['--import',pathToFileURL(path.join(root,'node_modules/tsx/dist/loader.mjs')).href,path.join(root,'apps/local-host/native-mcp.ts')];
  provider.serverConfiguration={args:['-c',prefix+'.command='+JSON.stringify(process.execPath),'-c',prefix+'.args='+JSON.stringify(proxyArgs),
    '-c',prefix+'.env_vars='+JSON.stringify(['WORKBENCH_URL','WORKBENCH_NATIVE_PROXY_TOKEN','WORKBENCH_CA']),'-c',prefix+'.required=true',
    // This owned relay still waits for per-call Workbench approval before invoking a document tool.
    '-c',prefix+'.tools.office_live.approval_mode="approve"','-c',prefix+'.tools.office_file.approval_mode="approve"'],
    env:{WORKBENCH_URL:origin,WORKBENCH_NATIVE_PROXY_TOKEN:proxyToken,WORKBENCH_CA:path.join(local,'server.cer')},allowedMcpServers:['workbench-native-docs']};
  provider.prepareMessage=async(text,selectionId)=>{
    const selected=selectionId?selections.lookup(selectionId,scopeId,task.doc):undefined;
    if(selected){
      if(selected.kind==='powerpoint-slides'||(selected.kind==='powerpoint'&&selected.shapeIds.length!==1&&!selected.shapeLayouts))throw new AppError('SELECTION_EDIT_UNSUPPORTED','Choose a supported object or up to20 nongroup shapes.',409);
      await nativeOffice.verifySelectionIdentity(selected);
    }
    const context=selected?frozenSelectionContext(selectionId!,selected):'';
    return {text:text+context,apply:()=>selectionGuard.set(scopeId,selected?{id:selectionId!,kind:selected.kind}:undefined)};
  };
  return provider;
},config.nativeWorkspace);
let coreReady=false;
let stopping=false;
const permissionDetails=new ManagedPermissionDetails();
const core=new AionCore({binary:config.aioncore,dataDir:path.join(local,'core-data'),port:config.corePort,password:config.coreSecret},event=>{
  permissionDetails.capture(event);
  if(event.name==='core.health'){
    coreReady=Boolean(event.data.healthy);
    // Recover only idle sessions; never interrupt an active or uncertain document write.
    if(!coreReady&&!stopping&&!nativeSessions.busy&&!messages.busy&&!optionUpdates.size&&!store.conversations().some(c=>c.turn)&&!broker.inFlight.size&&
      !store.operations().some(o=>o.status==='running'||o.status==='queued'))void shutdown(1);
  }
  if(event.name==='core.exited'||event.name==='core.error'){coreReady=false;permissionDetails.clear();}
  if(event.name==='core.exited'&&!stopping&&!nativeSessions.busy)setTimeout(()=>{if(!nativeSessions.busy)void shutdown(1);},1000).unref();
  if(event.name==='turn.completed'&&event.data?.conversation_id)messages.completed(event.data.conversation_id,event.data.turn_id);
  for(const client of viewers)if(client.readyState===WebSocket.OPEN)client.send(JSON.stringify({type:'core.event',event}));
});
const equal=(a:string,b:string)=>{const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);};
function authenticate(req:IncomingMessage) {
  const token=(req.headers.authorization || '').replace(/^Bearer /,'');
  if(equal(token,config.uiToken))return {role:'ui' as const};
  const proxy=nativeProxyGrants.get(digest(token));
  if(proxy)return {role:'native-proxy' as const,...proxy};
  const grant=store.grant(token);
  if(grant)return {role:'tool' as const,...grant};
  throw new AppError('UNAUTHORIZED','Pair this window with the local Workbench.',401);
}
function json(res:ServerResponse,body:unknown,status=200){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));}
async function bytes(req:IncomingMessage,limit=1024*1024) {
  const chunks:Buffer[]=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>limit)throw new AppError('BODY_TOO_LARGE','Request limit exceeded.',413);chunks.push(Buffer.from(chunk));}
  return Buffer.concat(chunks);
}
async function body(req:IncomingMessage) {
  const raw=(await bytes(req)).toString('utf8');
  try{return raw?JSON.parse(raw):{};}catch{throw new AppError('INVALID_JSON','Invalid JSON.');}
}
function knownConversation(id:string) {
  const found=store.conversations().find(c=>c.id===id);
  if(!found)throw new AppError('NOT_FOUND','Conversation is not part of this Workbench.',404);
  return found;
}

const server=https.createServer({pfx:fs.readFileSync(path.join(local,'server.pfx')),passphrase:config.pfxPassword},async(req,res)=>{
  try {
    if(req.headers.host!==`localhost:${config.port}`&&req.headers.host!==`127.0.0.1:${config.port}`)throw new AppError('HOST_REJECTED','Unrecognized host.',403);
    if(req.headers.origin&&req.headers.origin!==origin)throw new AppError('ORIGIN_REJECTED','Unrecognized origin.',403);
    const url=new URL(req.url || '/',origin),method=req.method || 'GET';let route=url.pathname;
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    if(route==='/health'){json(res,{status:coreReady?'ok':'starting',mode:'standalone',version:'0.1.0-alpha.2',coreReady,pid:process.pid});return;}
    if(route.startsWith('/api/')||route.startsWith('/tools/')){
      const auth=authenticate(req);
      if(auth.role==='native-proxy'){
        if(method==='POST'&&route==='/tools/native-catalog'){json(res,auth.provider.tools);return;}
        if(method==='POST'&&route==='/tools/native-call'){
          const data=await body(req),pending=nativeSessions.proxyCall(auth.scope,data);
          res.once('close',()=>{if(!res.writableEnded)nativeSessions.cancelProxy(auth.scope,data.callId);});
          json(res,await pending);return;
        }
        throw new AppError('FORBIDDEN','This credential only submits approved native document calls.',403);
      }
      if(auth.role==='tool'){
        if(method!=='POST'||!['/tools/live','/tools/capabilities','/tools/read','/tools/write','/tools/file','/tools/read-text','/tools/write-text','/tools/write-selection','/tools/format-selection','/tools/replace-selection','/tools/target','/tools/layout-selection','/tools/shapes','/tools/tables','/tools/table-batch','/tools/table-layout','/tools/table-layout-read','/tools/paragraph-batch','/tools/table-rows','/tools/excel-tables','/tools/excel-table-style','/tools/excel-table-rows','/tools/excel-sheets','/tools/excel-charts','/tools/excel-chart-layout','/tools/excel-chart-create','/tools/excel-range-format-read','/tools/excel-range-format','/tools/excel-table-create','/tools/excel-table-columns'].includes(route))throw new AppError('FORBIDDEN','This credential only grants scoped document tools.',403);
        let payload=await body(req);
        if(route==='/tools/live'){
          const doc=store.documents().find(d=>d.documentId===auth.doc);
          const plan=planLiveRequest({kind:doc?.kind??'file',capabilities:doc?.capabilities??[]},payload);
          if('help' in plan){json(res,plan.help);return;}
          route=plan.route;payload=plan.params;
        }
        selectionGuard.assert(auth.conversation,route,payload);
        if(route==='/tools/excel-range-format-read'){
          const selection=selections.lookup(payload.selectionId,auth.conversation,auth.doc);
          if(selection.kind!=='excel')throw new AppError('SELECTION_EDIT_UNSUPPORTED','Reference an Excel cell range.');
          const r=await broker.host(auth.doc).request('readExcelRangeFormat',{reference:{sheet:selection.sheet,range:selection.range,hostSessionId:selection.hostSessionId,dataRevision:selection.expectedRevision}});
          if(revision(r.rangeState)!==selection.expectedRevision)throw new AppError('REVISION_CONFLICT','Frozen source data changed.',409);
          const reference={...r.reference,dataRevision:revision(r.rangeState)};
          const profiles=new Map<string,{appearance:unknown;count:number}>();for(const appearance of r.cells){const key=canonical(appearance),existing=profiles.get(key);if(existing)existing.count++;else profiles.set(key,{appearance,count:1});}
          json(res,{reference,cellCount:r.cells.length,profiles:[...profiles.values()].slice(0,10),truncated:profiles.size>10,instruction:'Use this exact appearance reference and selectionId. Profiles are grouped counts, not cell order; full cell snapshots stay in the private journal.'});return;
        }
        if(route==='/tools/shapes'){
          const validated=hostTextReadSchema.parse(payload);
          if(!validated.slideId)throw new AppError('SLIDE_REQUIRED','Choose a slideId from office_read_text.');
          json(res,await broker.host(auth.doc).request('readPptShapes',validated));return;
        }
        if(route==='/tools/tables'){json(res,await broker.host(auth.doc).request('readWordTables',hostTextReadSchema.parse(payload)));return;}
        if(route==='/tools/excel-tables'){json(res,await broker.host(auth.doc).request('readExcelTables',excelTablesReadSchema.parse(payload)));return;}
        if(route==='/tools/excel-sheets'){json(res,await broker.host(auth.doc).request('readExcelSheets',excelSheetsReadSchema.parse(payload)));return;}
        if(route==='/tools/excel-charts'){json(res,await broker.host(auth.doc).request('readExcelCharts',excelChartsReadSchema.parse(payload)));return;}
        if(route==='/tools/table-layout-read'){for(const flag of ['includeWidths','includeBorders'])if(payload[flag]!==undefined&&typeof payload[flag]!=='boolean')throw new AppError('INVALID_ARGUMENT',flag+' must be boolean.');const r=await broker.host(auth.doc).request('readWordTableLayout',{reference:wordTableReferenceSchema.parse(payload.reference),includeWidths:payload.includeWidths===true,includeBorders:payload.includeBorders===true});json(res,{reference:r.reference,properties:r.properties,rowBreaks:r.rowBreaks,...(r.widths?{widths:{columnWidths:r.widths.columns,allowAutoFit:r.widths.allowAutoFit,preferredType:r.widths.preferredType,preferred:r.widths.preferred}}:{}),...(r.borders?{borders:r.borders.table}:{})});return;}
        if(route==='/tools/target'){
          const resolved=await nativeOffice.resolveTarget(auth.doc,payload);
          if(resolved.status!=='resolved'){json(res,resolved);return;}
          const ticket=selections.capture(auth.conversation,resolved.selection);
          json(res,{status:'resolved',selectionId:ticket.id,expiresAt:ticket.expiresAt,selection:ticket.selection});return;
        }
        if(route==='/tools/capabilities'){
          const doc=store.documents().find(d=>d.documentId===auth.doc);
          json(res,{kind:doc?.kind || 'file',capabilities:doc?.capabilities || []});return;
        }
        if(route==='/tools/file'){
          const nativeGrant=[...nativeProxyGrants.values()].find(value=>value.scope===auth.conversation),parent=nativeGrant?.provider.document.taskId;
          if(parent){if((knownConversation(parent).doc||'')!==auth.doc)throw new AppError('NATIVE_SOURCE_MISMATCH','Parent document binding changed; no file command issued.',409);syncTaskFileRefs(files,parent,auth.conversation);}
          const result=await files.command(payload,auth.conversation);
          if(parent&&result.file?.id){let linked=false;try{linked=(knownConversation(parent).doc||'')===auth.doc;}catch{}if(linked)files.attach(parent,result.file.id);result.delivery={taskId:parent,linked,...(!linked?{reason:'parent-binding-changed-or-missing'}:{})};}
          if(result.file?.id&&['create','batch','merge','import'].includes(payload.action))filesChanged(parent??auth.conversation);
          json(res,fileToolResult(payload.action,result));return;
        }
        if(route==='/tools/read-text'){json(res,await broker.readText(auth.doc,payload));return;}
        if(route==='/tools/read'){
          const data=rangeRequestSchema.parse({...payload,documentId:auth.doc});
          json(res,await broker.read(auth.doc,data.sheet,data.range));return;
        }
        if(typeof payload.operationId!=='string'||!/^[A-Za-z0-9_-]{1,60}$/.test(payload.operationId))throw new AppError('INVALID_OPERATION_ID','Use 1 to 60 letters, digits, underscores or hyphens.');
        const operationId=`${auth.conversation.slice(0,32)}_${payload.operationId}`;
        if(route==='/tools/excel-table-create'){
          const selection=payload.selectionId?selections.forOperation(payload.selectionId,auth.conversation,auth.doc,operationId):undefined;
          if(selection&&(selection.kind!=='excel'||selection.table))throw new AppError('TABLE_SOURCE_REQUIRED','Reference an ordinary data range, not an existing table or chart.',409);
          const source=selection?.kind==='excel'?{sheet:selection.sheet,range:selection.range,hostSessionId:selection.hostSessionId,revision:selection.expectedRevision}:payload.source;
          if(selection&&payload.source!==undefined&&canonical(payload.source)!==canonical(source))throw new AppError('SELECTION_SCOPE','Do not substitute the frozen table source.',403);
          const operation=await createExcelTable(broker,auth.doc,{operationId,source,name:payload.name,properties:payload.properties},selection);
          json(res,{...writeToolResult(operation),...(selection?{selectionReference:selections.complete(payload.selectionId,auth.conversation,auth.doc,operation)}:{})});return;
        }
        if(route==='/tools/excel-range-format'){
          const selection=payload.selectionId?selections.forOperation(payload.selectionId,auth.conversation,auth.doc,operationId):undefined;
          if(selection&&(selection.kind!=='excel'||payload.reference?.sheet!==selection.sheet||payload.reference?.range!==selection.range||payload.reference?.hostSessionId!==selection.hostSessionId||payload.reference?.dataRevision!==selection.expectedRevision))throw new AppError('SELECTION_SCOPE','Use the exact frozen range and its appearance reference.',403);
          const operation=await formatExcelRange(broker,auth.doc,{operationId,reference:payload.reference,properties:payload.properties},selection);
          json(res,{...writeToolResult(operation),...(selection?{selectionReference:selections.complete(payload.selectionId,auth.conversation,auth.doc,operation)}:{})});return;
        }
        if(route==='/tools/excel-chart-create'){
          const selection=payload.selectionId?selections.forOperation(payload.selectionId,auth.conversation,auth.doc,operationId):undefined;
          if(selection&&selection.kind!=='excel')throw new AppError('CHART_SOURCE_SELECTION_REQUIRED','Reference a data range, not an existing chart.',409);
          const source=selection?.kind==='excel'?{sheet:selection.sheet,range:selection.range,hostSessionId:selection.hostSessionId,revision:selection.expectedRevision}:payload.source;
          if(selection&&payload.source!==undefined&&canonical(payload.source)!==canonical(source))throw new AppError('SELECTION_SCOPE','Do not substitute the frozen chart source.',403);
          const operation=await createExcelChart(broker,auth.doc,{operationId,source,name:payload.name,type:payload.type,title:payload.title,legend:payload.legend,style:payload.style,geometry:payload.geometry},selection);
          json(res,{...writeToolResult(operation),...(selection?{selectionReference:selections.complete(payload.selectionId,auth.conversation,auth.doc,operation)}:{})});return;
        }
        if(route==='/tools/excel-chart-layout'){
          const selection=payload.selectionId?selections.forOperation(payload.selectionId,auth.conversation,auth.doc,operationId):undefined;
          if(selection&&selection.kind!=='excel-chart')throw new AppError('CHART_SELECTION_REQUIRED','Reference one complete embedded chart, not cells.',409);
          if(selection?.kind==='excel-chart'&&payload.reference!==undefined&&canonical(payload.reference)!==canonical(selection.chart))throw new AppError('SELECTION_SCOPE','Do not substitute the referenced chart.',403);
          const reference=selection?.kind==='excel-chart'?selection.chart:payload.reference;
          const operation=await layoutExcelChart(broker,auth.doc,{operationId,reference,geometry:payload.geometry,properties:payload.properties},selection);
          json(res,{...writeToolResult(operation),...(selection?{selectionReference:selections.complete(payload.selectionId,auth.conversation,auth.doc,operation)}:{})});return;
        }
        if(['/tools/excel-table-style','/tools/excel-table-rows','/tools/excel-table-columns'].includes(route)){
          const selection=payload.selectionId?selections.forOperation(payload.selectionId,auth.conversation,auth.doc,operationId):undefined;
          if(selection&&(selection.kind!=='excel'||!selection.table))throw new AppError('TABLE_SELECTION_REQUIRED','Select the complete Excel table, not part of it.',409);
          if(selection?.kind==='excel'&&payload.reference!==undefined&&canonical(payload.reference)!==canonical(selection.table))throw new AppError('SELECTION_SCOPE','Do not substitute the referenced table.',403);
          const reference=selection?.kind==='excel'?selection.table:payload.reference;
          const operation=route==='/tools/excel-table-columns'?await appendExcelColumns(broker,auth.doc,{operationId,reference,append:payload.append},selection):route==='/tools/excel-table-rows'?await appendExcelTable(broker,auth.doc,{operationId,reference,append:payload.append,formulas:payload.formulas},selection):await styleExcelTable(broker,auth.doc,{operationId,reference,properties:payload.properties},selection);
          let selectionReference:unknown={status:'not-advanced'};
          if(selection?.kind==='excel'&&operation.status==='applied'){
            const r=operation.result as any;selectionReference=selections.complete(payload.selectionId,auth.conversation,auth.doc,{...operation,result:{...r,continuationSelection:{...selection,range:r.after.reference.range,table:r.after.reference,contentHash:revision(r.after.rangeState),expectedRevision:revision(r.after.rangeState),preview:JSON.stringify(r.after.rangeState).slice(0,4000)}}});
          }
          json(res,{...writeToolResult(operation),...(selection?{selectionReference}:{})});return;
        }
        if(['/tools/table-batch','/tools/table-layout','/tools/table-rows'].includes(route)){
          const execute=(reference:unknown)=>route==='/tools/table-batch'?editWordTableBatch(broker,auth.doc,{operationId,reference,edits:payload.edits}):route==='/tools/table-layout'?layoutWordTable(broker,auth.doc,{operationId,reference,properties:payload.properties}):appendWordTableRows(broker,auth.doc,{operationId,reference,append:payload.append});
          if(payload.selectionId){const r=await mutateSelectedTable(selections,broker,{conversation:auth.conversation,documentId:auth.doc},{selectionId:payload.selectionId,operationId,reference:payload.reference},execute);json(res,{...writeToolResult(r.operation),selectionReference:r.selectionReference});}
          else json(res,writeToolResult(await execute(payload.reference)));
          return;
        }
        if(route==='/tools/paragraph-batch'){
          const selection=selections.forOperation(payload.selectionId,auth.conversation,auth.doc,operationId);
          const operation=await replaceWordParagraphBatch(broker,auth.doc,{operationId,selection,paragraphs:payload.paragraphs});
          json(res,{...writeToolResult(operation),selectionReference:selections.complete(payload.selectionId,auth.conversation,auth.doc,operation)});return;
        }
        if(route==='/tools/layout-selection'){
          const selection=selections.forOperation(payload.selectionId,auth.conversation,auth.doc,operationId);
          if(payload.edits!==undefined&&(payload.geometry!==undefined||payload.textFrame!==undefined||payload.appearance!==undefined))throw new AppError('INVALID_LAYOUT','Supply single-shape properties or multi-shape edits, not both.');
          const operation=payload.edits!==undefined?await layoutPptBatch(broker,auth.doc,{selection,operationId,edits:payload.edits}):await layoutPptSelection(broker,auth.doc,{selection,operationId,...(payload.geometry!==undefined?{geometry:payload.geometry}:{}),...(payload.textFrame!==undefined?{textFrame:payload.textFrame}:{}),...(payload.appearance!==undefined?{appearance:payload.appearance}:{})});
          json(res,{...writeToolResult(operation),selectionReference:selections.complete(payload.selectionId,auth.conversation,auth.doc,operation)});return;
        }
        if(route==='/tools/replace-selection'){
          const selection=selections.forOperation(payload.selectionId,auth.conversation,auth.doc,operationId);
          const execute=selection.kind==='powerpoint'?replacePptSelection:replaceWordSelection;
          const operation=await execute(broker,auth.doc,{selection,operationId,text:payload.text});
          json(res,{...writeToolResult(operation),selectionReference:selections.complete(payload.selectionId,auth.conversation,auth.doc,operation)});return;
        }
        if(route==='/tools/format-selection'){
          const selection=selections.forOperation(payload.selectionId,auth.conversation,auth.doc,operationId);
          const execute=selection.kind==='powerpoint'?formatPptSelection:formatWordSelection;
          const formatting=selection.kind==='powerpoint'?{font:payload.font,...(payload.paragraph===undefined?{}:{paragraph:payload.paragraph})}:{font:payload.font,paragraph:payload.paragraph};
          const operation=await execute(broker,auth.doc,{selection,operationId,...formatting});
          json(res,{...writeToolResult(operation),selectionReference:selections.complete(payload.selectionId,auth.conversation,auth.doc,operation)});return;
        }
        if(route==='/tools/write-selection'){
          const operation=await writeExcelSelection(selections,broker,{conversation:auth.conversation,documentId:auth.doc},{...payload,operationId},selection=>nativeOffice.verifySelectionIdentity(selection));
          json(res,{...writeToolResult(operation),selectionReference:selections.complete(payload.selectionId,auth.conversation,auth.doc,operation)});return;
        }
        if(route==='/tools/write-text'){json(res,writeToolResult(await broker.writeText(auth.doc,{...payload,operationId})));return;}
        json(res,writeToolResult(await broker.write({...payload,documentId:auth.doc,operationId})));return;
      }
      if(route==='/api/admin/shutdown'&&method==='POST'){
        if(nativeSessions.busy||messages.busy||optionUpdates.size||store.conversations().some(c=>c.turn)||broker.inFlight.size||store.operations().some(o=>o.status==='running'||o.status==='queued'))throw new AppError('TASKS_RUNNING','Stop active tasks before shutting down the workbench.',409);
        json(res,{stopping:true});setTimeout(()=>void shutdown(),100);return;
      }
      if(route==='/api/status'){
        let gateway:any={};try{gateway=await(await fetch(config.gatewayUrl+'/healthz',{signal:AbortSignal.timeout(2000)})).json();}catch{}
        json(res,{version:'0.1.0-alpha.2',mode:'standalone',coreReady,nativeError,selectionPreview:true,certificate:certificateMaintenance(certificateValidTo),connectionSource:config.connectionSource,provider:gateway.active_provider || 'Unknown',model:config.model,
          documents:store.documents().map(d=>({...d,online:broker.hosts.has(d.documentId)}))});return;
      }
      if(route==='/api/native-sessions'&&method==='GET'){json(res,nativeSessions.list(Number(url.searchParams.get('after')??'0')));return;}
      if(route==='/api/native-sessions'&&method==='POST'){json(res,await nativeSessions.create(await body(req)),201);return;}
      const nativeSessionRoute=/^\/api\/native-sessions\/([a-f0-9-]{36})\/(events|receipts|send|close|resume|reconcile|retire|interrupt|terminal|approvals|confirm|selection|operations|restore)$/.exec(route);
      if(nativeSessionRoute){
        const [,id,action]=nativeSessionRoute;
        if(method==='GET'&&action==='operations'){
          const doc=nativeSessions.document(id),operationId=url.searchParams.get('operationId');
          if(operationId!==null){if(!doc||!/^[a-zA-Z0-9_-]{1,200}$/.test(operationId))throw new AppError('NATIVE_OPERATION_SCOPE','Invalid operation reference.',403);json(res,assertNativeOperationForStore(store,id,doc.documentId,operationId));return;}
          const operations=doc?nativeOperationsForStore(store,id,doc.documentId):[];
          json(res,url.searchParams.get('summary')==='1'?nativeOperationPage(operations,url.searchParams.get('before')??undefined):operations);return;
        }
        if(method==='POST'&&action==='restore'){
          nativeSessions.assertIdle(id);const doc=nativeSessions.document(id),data=await body(req);
          if(!doc||typeof data.operationId!=='string')throw new AppError('NATIVE_OPERATION_SCOPE','A session document operation is required.',403);
          assertNativeOperationForStore(store,id,doc.documentId,data.operationId);
          json(res,await restoreOperation(broker,data.operationId));return;
        }
        if(method==='GET'&&action==='events'){json(res,nativeSessions.events(id,Number(url.searchParams.get('after')??'0')));return;}
        if(method==='GET'&&action==='receipts'){json(res,nativeSessions.receipts(id,Number(url.searchParams.get('after')??'0')));return;}
        if(method==='POST'&&action==='send'){json(res,await nativeSessions.send(id,await body(req)));return;}
        if(method==='POST'&&action==='close'){json(res,await nativeSessions.close(id));return;}
        if(method==='POST'&&action==='resume'){json(res,await nativeSessions.resume(id));return;}
        if(method==='POST'&&action==='interrupt'){json(res,await nativeSessions.interrupt(id));return;}
        if(method==='POST'&&(action==='reconcile'||action==='retire')){
          const doc=nativeSessions.document(id),unresolved=doc?unresolvedNativeOperationsForStore(store,id,doc.documentId):[];
          json(res,action==='retire'?await nativeSessions.retireUncertain(id,unresolved):await nativeSessions.reconcile(id,unresolved));return;
        }
        if(method==='POST'&&action==='terminal'){res.setHeader('Cache-Control','no-store');json(res,await nativeSessions.terminal(id));return;}
        if(method==='GET'&&action==='approvals'){json(res,nativeSessions.approvals(id));return;}
        if(method==='POST'&&action==='confirm'){json(res,await nativeSessions.confirm(id,await body(req)));return;}
        if(method==='POST'&&action==='selection'){
          const document=nativeSessions.document(id);if(!document?.documentId)throw new AppError('SELECTION_SCOPE','This session is not connected to a live document.',409);
          json(res,await captureBoundSelection({id,documentId:document.documentId},doc=>nativeOffice.captureSelection(doc),selections));return;
        }
      }
      if(route==='/api/native/documents'&&method==='GET'){json(res,await nativeOffice.refreshBound(broker));return;}
      if(route==='/api/native/selection'&&method==='POST'){
        const data=await body(req);
        if(typeof data.conversationId!=='string')throw new AppError('SELECTION_SCOPE','Select a task before capturing a selection.');
        const link=knownConversation(data.conversationId);
        json(res,await captureBoundSelection({id:link.id,documentId:link.doc},id=>nativeOffice.captureSelection(id),selections));return;
      }
      if(route==='/api/native/bind'&&method==='POST'){
        const data=await body(req),discovered=await nativeOffice.discover(),doc=discovered.documents.find(d=>d.id===data.id);
        if(!doc)throw new AppError('NATIVE_DOCUMENT_OFFLINE','Select a document currently open in Office.',409);
        const host=nativeOffice.host(doc),old=broker.hosts.get(host.binding.documentId);if(old)broker.detach(old);broker.attach(host);json(res,host.binding);return;
      }
      if(route==='/api/agents'&&method==='GET'){if(!coreReady)throw new AppError('CORE_OFFLINE','Agent backend is not ready.',503);json(res,await catalog(core,config.gatewayUrl));return;}
      if(route==='/api/archives'&&method==='GET'){json(res,archives.list());return;}
      if(route==='/api/archives'&&method==='POST'){json(res,archives.import((await bytes(req,8*1024*1024)).toString('utf8'),url.searchParams.get('name')||'Imported history'),201);return;}
      const archiveMatch=/^\/api\/archives\/([a-f0-9]{64})(\/export)?$/.exec(route);
      if(archiveMatch&&method==='GET'){
        json(res,archiveMatch[2]?archives.export(archiveMatch[1]):archives.read(archiveMatch[1],Number(url.searchParams.get('offset')||'0')));return;
      }
      if(route==='/api/providers'&&method==='POST'){if(!coreReady)throw new AppError('CORE_OFFLINE','Agent backend is not ready.',503);json(res,await addProvider(core,await body(req)));return;}
      if(route==='/api/files'&&method==='GET'){const conversation=url.searchParams.get('conversation') || undefined;if(conversation)knownConversation(conversation);json(res,files.list(conversation));return;}
      if(route==='/api/files'&&method==='POST'){
        const conversation=url.searchParams.get('conversation');if(conversation)knownConversation(conversation);
        const record=await files.put(url.searchParams.get('name') || '',await bytes(req,32*1024*1024));
        if(conversation)files.attach(conversation,record.id);filesChanged(conversation??undefined);json(res,record,201);return;
      }
      const fileMatch=/^\/api\/files\/([a-f0-9-]{36})\/(download|attach)$/.exec(route);
      if(fileMatch&&fileMatch[2]==='download'&&method==='GET'){
        const record=files.get(fileMatch[1]),filename=await files.checkedFile(record.id);
        res.writeHead(200,{'Content-Type':record.mediaType,'Content-Disposition':`attachment; filename="document.${record.extension}"; filename*=UTF-8''${encodeURIComponent(record.name)}`,'Cache-Control':'no-store'});fs.createReadStream(filename).pipe(res);return;
      }
      if(fileMatch&&fileMatch[2]==='attach'&&method==='POST'){const data=await body(req);knownConversation(data.conversationId);files.attach(data.conversationId,fileMatch[1]);filesChanged(data.conversationId);json(res,{ok:true});return;}
      if(route==='/api/file-command'&&method==='POST'){const data=await body(req);const {conversationId,...request}=data;if(conversationId!==undefined){if(typeof conversationId!=='string')throw new AppError('FILE_SCOPE','Invalid task reference.',403);knownConversation(conversationId);}const result=await files.command(request,conversationId);if(result.file?.id&&['create','batch','merge','import'].includes(request.action))filesChanged(conversationId);json(res,result);return;}
      if(route==='/api/events'){const after=Number(url.searchParams.get('after') || '0');json(res,store.events(Number.isSafeInteger(after)&&after>=0?after:0));return;}
      if(route==='/api/operations'){json(res,store.operations());return;}
      if(route==='/api/read'&&method==='POST'){const data=rangeRequestSchema.parse(await body(req));json(res,await broker.read(data.documentId,data.sheet,data.range));return;}
      if(route==='/api/write'&&method==='POST'){json(res,await broker.write(await body(req)));return;}
      if(route==='/api/read-text'&&method==='POST'){const {documentId,...data}=await body(req);json(res,await broker.readText(documentId,data));return;}
      if(route==='/api/write-text'&&method==='POST'){const {documentId,...data}=await body(req);json(res,await broker.writeText(documentId,data));return;}
      if(route==='/api/snapshot'&&method==='POST'){
        const data=await body(req),doc=broker.host(data.documentId).binding,snapshot=await broker.snapshot(data.documentId);
        const ext=doc.kind==='excel'?'xlsx':doc.kind==='word'?'docx':'pptx';
        const artifact=await files.put(`snapshot.${ext}`,Buffer.from(snapshot.base64,'base64'));
        if(data.conversationId){knownConversation(data.conversationId);files.attach(data.conversationId,artifact.id);}
        store.event('artifact.created',{id:artifact.id,documentId:data.documentId,sha256:artifact.sha256});json(res,artifact);return;
      }
      if(route==='/api/restore'&&method==='POST'){
        const data=await body(req);if(typeof data.operationId!=='string'||data.operationId.length>100)throw new AppError('INVALID_OPERATION','An operation ID is required.');
        json(res,await restoreOperation(broker,data.operationId));return;
      }
      if(route==='/api/copy-batch'&&method==='POST'){
        const data=await body(req);const result=await engine.copyBatch(data.artifactId,data.edit);
        store.event('artifact.created',result);json(res,result);return;
      }
      const artifactMatch=/^\/api\/artifacts\/([a-f0-9-]{36})$/.exec(route);
      if(artifactMatch&&method==='GET'){
        const file=engine.path(artifactMatch[1]);if(!fs.existsSync(file))throw new AppError('NOT_FOUND','Artifact not found.',404);
        res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="workbench-result.xlsx"'});
        fs.createReadStream(file).pipe(res);return;
      }
      if(route==='/api/conversations'&&method==='GET'){json(res,store.conversations().map(c=>({id:c.id,documentId:c.doc,turn:c.turn,...c.body})));return;}
      if(route==='/api/conversations'&&method==='POST'){
        if(!coreReady)throw new AppError('CORE_OFFLINE','Agent backend is not ready.',503);
        const data=await body(req);const doc=data.documentId?broker.host(String(data.documentId)).binding:undefined;
        const available=await catalog(core,config.gatewayUrl),agent=available.agents.find(a=>a.id===(data.agent || 'aionrs'));
        if(!agent?.available)throw new AppError('AGENT_UNAVAILABLE','The selected agent is not installed or available.');
        const providerId=data.providerId || 'workbench-ccswitch',provider=available.providers.find((p:any)=>p.id===providerId);
        if(agent.type==='aionrs'&&!provider)throw new AppError('PROVIDER_NOT_FOUND','Select a configured provider.');
        const model=data.model || provider?.models[0] || config.model;
        if(typeof model!=='string'||model.length>200)throw new AppError('INVALID_MODEL','Invalid model identifier.');
        const workspace=path.join(local,'workspaces',randomUUID());fs.mkdirSync(workspace,{recursive:true});
        const grant=randomBytes(32).toString('base64url');
        const created=await core.request('POST','/api/conversations',{
          type:agent.type,name:String(data.name || doc?.name || 'File task').slice(0,100),...(agent.type==='aionrs'?{model:{provider_id:providerId,model}}:{}),
          extra:{workspace,backend:agent.backend,...(agent.type==='acp'?{agent_id:agent.id}:{}),session_mode:'default',selected_mcp_server_ids:[],selected_session_mcp_servers:[{
            id:'office-workbench',name:'office-workbench',transport:{type:'stdio',command:process.execPath,
              args:['--import',pathToFileURL(path.join(root,'node_modules/tsx/dist/loader.mjs')).href,path.join(root,'apps/local-host/mcp.ts')],
              env:{WORKBENCH_URL:origin,WORKBENCH_TOOL_TOKEN:grant,WORKBENCH_CA:path.join(local,'server.cer')}}}],
            preset_rules:managedDocumentInstructions,
            preset_context:'Read exact targets and versions before writes. Ask when the target is unclear. PDF inspect/view supports --start/--end (up to5 pages, text layer only).'}
        });
        store.addGrant(grant,doc?.documentId || '',created.id);
        store.linkConversation(created.id,doc?.documentId || '',{name:created.name || doc?.name || 'File task',model:agent.type==='aionrs'?model:'native',providerId:agent.type==='aionrs'?providerId:null,agent:agent.id,source:agent.type==='aionrs'?provider?.source:'native',workspace});
        store.event('conversation.created',{id:created.id,documentId:doc?.documentId || ''});json(res,{id:created.id});return;
      }
      const match=/^\/api\/conversations\/([\w-]+)\/(messages|state|cancel|confirmations|confirm|access|features|answer|runtime-options|option)$/.exec(route);
      if(match){
        const [,id,action]=match;const link=knownConversation(id);
        if(action==='access'&&method==='POST'){
          const grant=randomBytes(32).toString('base64url');store.addGrant(grant,link.doc || '',id);
          json(res,{mcpServers:{'office-workbench':{command:process.execPath,args:['--import',pathToFileURL(path.join(root,'node_modules/tsx/dist/loader.mjs')).href,path.join(root,'apps/local-host/mcp.ts')],env:{WORKBENCH_URL:origin,WORKBENCH_TOOL_TOKEN:grant,WORKBENCH_CA:path.join(local,'server.cer')}}}});return;
        }
        if(action==='access'&&method==='DELETE'){
          const data=await body(req);if(typeof data.token!=='string'||!/^[-_A-Za-z0-9]{32,128}$/.test(data.token)||store.grant(data.token)?.conversation!==id)throw new AppError('GRANT_SCOPE','Only an exact credential issued for this task can be revoked.',403);
          store.revokeGrant(data.token);json(res,{revoked:true});return;
        }
        if(!coreReady)throw new AppError('CORE_OFFLINE','Agent backend is not ready.',503);
        if((action==='runtime-options'||action==='option')&&method==='POST'){
          if(messages.busy||optionUpdates.has(id))throw new AppError('CONVERSATION_BUSY','Wait for pending requests before changing agent settings.',409);
          optionUpdates.add(id);
          try{
            const state=await core.request('GET',`/api/conversations/${id}`);
            if(state.runtime?.state!=='idle'||state.runtime?.is_processing||state.runtime?.turn_id)throw new AppError('CONVERSATION_BUSY','Wait for the current turn to finish.',409);
            const ready=await core.request('POST',`/api/conversations/${id}/runtime/ensure`,null);
            if(action==='runtime-options'){json(res,{options:agentOptions(ready.config_options)});return;}
            const data=await body(req),choice=validateAgentOption(ready.config_options,data.optionId,data.value);
            const result=await core.request('PUT',`/api/conversations/${id}/config-options/${encodeURIComponent(choice.optionId)}`,{value:choice.value});
            const options=observedAgentOption(result,choice.optionId,choice.value);
            store.event('conversation.option.changed',{id,...choice});json(res,{options,confirmed:true});return;
          }finally{optionUpdates.delete(id);}
        }
        if(action==='features'&&method==='GET'){
          let usage=null,commands:any[]=[];
          try{usage=await core.request('GET',`/api/conversations/${id}/usage`);}catch{}
          try{const result=await core.request('GET',`/api/conversations/${id}/slash-commands`);if(Array.isArray(result))commands=result;}catch{}
          json(res,{usage:reportedUsage(usage),commands:commands.map(c=>({name:c.command || c.name,description:typeof c.description==='string'?c.description.slice(0,1000):''})).filter(c=>typeof c.name==='string')});return;
        }
        if(action==='messages'&&method==='GET'){const before=url.searchParams.get('before');if(before&&before.length>1000)throw new AppError('CURSOR_LIMIT','Invalid history cursor.');json(res,await core.request('GET',`/api/conversations/${id}/messages?limit=100${before?'&before='+encodeURIComponent(before):''}`));return;}
        if(action==='messages'&&method==='POST'){
          const data=await body(req);if(typeof data.content!=='string'||!data.content.trim()||data.content.length>20000)throw new AppError('INVALID_MESSAGE','Message must contain 1 to 20,000 characters.');
          const attached=data.files || [];if(!Array.isArray(attached)||attached.length>10||attached.some((v:any)=>typeof v!=='string'))throw new AppError('FILE_LIMIT','Attach at most ten files.');
          if(data.selectionId!==undefined&&(typeof data.selectionId!=='string'||data.selectionId.length>100))throw new AppError('SELECTION_SCOPE','Invalid selection reference.');
          const receipt=await messages.send(id,data.requestId,{content:data.content,files:attached,...(data.selectionId?{selectionId:data.selectionId}:{})},async()=>{
          if(optionUpdates.has(id))throw new AppError('CONVERSATION_BUSY','Agent settings are being refreshed; wait before sending.',409);
          const state=await core.request('GET',`/api/conversations/${id}`);
          if(state.runtime?.is_processing||state.runtime?.turn_id||state.runtime?.state!=='idle')throw new AppError('CONVERSATION_BUSY','This task is active or its runtime state is unavailable.',409);
          const refs:any[]=[],descriptions:string[]=[];
          let selectionContext='',selectionKind:import('../../packages/contracts/selection.ts').CapturedSelection['kind']|undefined;
          if(data.selectionId){
            const selected=selections.lookup(data.selectionId,id,link.doc);
            selectionKind=selected.kind;
            if(selected.kind==='powerpoint-slides'||(selected.kind==='powerpoint'&&selected.shapeIds.length!==1&&!selected.shapeLayouts))throw new AppError('SELECTION_EDIT_UNSUPPORTED','Select a supported range or up to20 nongroup shapes.',409);
            await nativeOffice.verifySelectionIdentity(selected);
            selectionContext=frozenSelectionContext(data.selectionId,selected);
          }
          for(const fileId of new Set<string>(attached)){
            const file=files.get(fileId);files.attach(id,fileId);descriptions.push(`${file.name}: fileId=${file.id}, format=${file.extension}`);
            if(['png','jpg','jpeg','pdf','txt','md','csv','tsv'].includes(file.extension)){
              const directory=path.join(local,'agent-attachments',id);fs.mkdirSync(directory,{recursive:true});
              const copy=path.join(directory,`${randomUUID()}.${file.extension}`);fs.copyFileSync(await files.checkedFile(file.id),copy,fs.constants.COPYFILE_EXCL);
              refs.push({kind:'local',path:copy});
            }
          }
          const content=data.content+selectionContext+(descriptions.length?'\n\nAttached files (use office_file for structured Office inspection):\n'+descriptions.join('\n'):'');
          return async()=>{selectionGuard.set(id,data.selectionId&&selectionKind?{id:data.selectionId,kind:selectionKind}:undefined);const result=await core.request('POST',`/api/conversations/${id}/messages`,{content,files:refs});return {turnId:result.turn_id,messageId:result.msg_id};};
          });
          json(res,receipt);return;
        }
        if(action==='state'){
          const state=await core.request('GET',`/api/conversations/${id}`);
          if(state.runtime?.state==='idle'&&state.runtime?.is_processing===false&&!state.runtime?.turn_id)store.turn(id,null);
          json(res,{id:state.id,name:state.name,runtime:state.runtime});return;
        }
        if(action==='cancel'&&method==='POST'){
          if(!link.turn)throw new AppError('NO_TURN','No active turn.');
          json(res,await core.request('POST',`/api/conversations/${id}/cancel`,{turn_id:link.turn}));return;
        }
        if(action==='confirmations'&&method==='GET'){
          const pending=await core.request('GET',`/api/conversations/${id}/confirmations`);
          const native=link.body.source==='native';
          const history=!native&&pending.some((c:any)=>!c.msg_id)?await core.request('GET',`/api/conversations/${id}/messages?limit=100`):{items:[]};
          json(res,pending.map((c:any)=>{const normalized=normalizedApproval(c,native,history.items??[]);return native?permissionDetails.enrich(normalized,id,link.turn):normalized;}));return;
        }
        if(action==='confirm'&&method==='POST'){
          const data=await body(req);
          if(typeof data.callId!=='string'||typeof data.msgId!=='string'||typeof data.allow!=='boolean')throw new AppError('INVALID_CONFIRMATION','A tool call, message ID and explicit decision are required.');
          const pending=await core.request('GET',`/api/conversations/${id}/confirmations`),item=pending.find((c:any)=>c.call_id===data.callId);
          if(!item)throw new AppError('CONFIRMATION_EXPIRED','This approval is no longer pending.',409);
          if(Array.isArray(item.questions)&&item.questions.length)throw new AppError('USE_QUESTION_CHANNEL','Answer structured questions through the question form.');
          const native=link.body.source==='native';
          const history=!native&&!item.msg_id?await core.request('GET',`/api/conversations/${id}/messages?limit=100`):{items:[]};
          const normalized=normalizedApproval(item,native,history.items??[]),resolved=native?permissionDetails.enrich(normalized,id,link.turn):normalized;
          if(data.allow&&resolved.permissionDetails?.state==='conflict')throw new AppError('APPROVAL_INPUT_CONFLICT','This permission ID reported changing parameters; inspect before approving.',409);
          if(!resolved.msg_id||resolved.msg_id!==data.msgId)throw new AppError('APPROVAL_IDENTITY_MISMATCH','Approval does not match a uniquely identified pending tool message.',409);
          json(res,await core.request('POST',`/api/conversations/${id}/confirmations/${encodeURIComponent(data.callId)}/confirm`,{msg_id:resolved.msg_id,data:{value:approvalChoice(item,data.allow)},always_allow:false}));return;
        }
        if(action==='answer'&&method==='POST'){
          const data=await body(req);
          if(typeof data.requestId!=='string'||data.requestId.length>200)throw new AppError('INVALID_REQUEST','Question request ID required.');
          const pending=await core.request('GET',`/api/conversations/${id}/confirmations`),item=pending.find((c:any)=>c.call_id===data.requestId);
          if(!item)throw new AppError('QUESTION_EXPIRED','The question is no longer pending.',409);
          json(res,await core.request('POST',`/api/conversations/${id}/asks/${encodeURIComponent(data.requestId)}/answer`,questionAnswer(item,data)));return;
        }
      }
      throw new AppError('NOT_FOUND','Route not found.',404);
    }
    if(method!=='GET')throw new AppError('METHOD_NOT_ALLOWED','GET required.',405);
    const file=route==='/'?path.join(root,'dist/index.html'):path.resolve(root,'dist','.'+decodeURIComponent(route));
    if(!file.startsWith(path.join(root,'dist')+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())throw new AppError('NOT_FOUND','Page not found. Build the frontend first.',404);
    const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
    res.writeHead(200,{'Content-Type':mime[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-cache'});fs.createReadStream(file).pipe(res);
  }catch(error){if(!res.headersSent)json(res,{code:error instanceof AppError?error.code:'REQUEST_FAILED',message:error instanceof Error?error.message:'Request failed',...(error instanceof FileBatchError?{operation:error.receipt}:{})},error instanceof AppError?error.status:400);else res.destroy();}
});

const wss=new WebSocketServer({noServer:true,maxPayload:48*1024*1024,handleProtocols:()=> 'workbench'});
server.on('upgrade',(req,socket,head)=>{
  const protocols=String(req.headers['sec-websocket-protocol'] || '').split(',').map(v=>v.trim());
  if(req.headers.origin!==origin||!equal(protocols[1] || '',config.uiToken)||req.url!=='/ws'){
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');socket.destroy();return;
  }
  wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws));
});
wss.on('connection',(socket:WebSocket)=>{
  viewers.add(socket);
  socket.on('message',async raw=>{
    try{
      const msg=JSON.parse(raw.toString());
      if(msg.type==='host.bind'){
        throw new AppError('ADDIN_RETIRED','Office add-in transport is retired. Use the standalone window and native document picker.');
      }else if(msg.type==='ping')socket.send(JSON.stringify({type:'pong'}));
    }catch(error){socket.send(JSON.stringify({type:'error',message:error instanceof Error?error.message:'Invalid message'}));}
  });
  socket.on('error',()=>{});
  socket.on('close',()=>{viewers.delete(socket);});
});

await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(config.port,'127.0.0.1',resolve);});
console.log(`Office Workbench listening at ${origin}`);
try{
  await core.start();
  const providers=await core.request('GET','/api/providers');
  const list=Array.isArray(providers)?providers:providers.items || providers.providers || [];
  if(!list.some((p:any)=>p.id==='workbench-ccswitch'))await core.request('POST','/api/providers',{
    id:'workbench-ccswitch',platform:'anthropic',name:'Workbench CC-Switch',base_url:config.gatewayUrl,
    api_key:'PROXY_MANAGED',models:[config.model],enabled:true});
  coreReady=true;console.log('Authenticated AionCore ready.');
  for(const link of store.conversations()){
    if(!link.turn)continue;
    try {
      const state=await core.request('GET',`/api/conversations/${link.id}`);
      if(state.runtime?.state==='idle'&&state.runtime?.is_processing===false&&!state.runtime?.turn_id)store.turn(link.id,null);
    } catch {console.warn('Could not reconcile a saved turn; history was retained.');}
  }
}catch(error){console.error('AionCore startup:',error instanceof Error?error.message:'failed');await shutdown(1);}
async function shutdown(exitCode=0){if(stopping)return;stopping=true;clearInterval(nativeTimer);await nativeSessions.stopAll();await nativeOffice.stop();for(const socket of viewers)socket.close();await core.stop();server.close();store.close();process.exit(exitCode);}
process.on('SIGINT',()=>void shutdown());process.on('SIGTERM',()=>void shutdown());
