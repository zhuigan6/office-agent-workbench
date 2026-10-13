import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import type { DatabaseSync } from 'node:sqlite';
import { AppError } from '../contracts/index.ts';
import { parseNative, type NativeOwner } from '../contracts/native-session.ts';
import { NativeSessionStore } from './store.ts';
import { CodexRpc } from './codex-rpc.ts';
import { CodexLinkedSession } from './codex-session.ts';
import { findCodexLauncher, findCodexBinary, inspectCodexRuntime } from './codex-runtime.ts';
import { startCodexServer,inspectCodexMcpConfig,scopedCodexMcpArgs,assertScopedCodexMcp } from './codex-server.ts';
import {NativeDocumentBridge,type NativeToolProvider} from './document-tools.ts';
import {RuntimeValidationCache} from './validation-cache.ts';
import {assertOriginalWorkspace} from './workspace-identity.ts';
import {nativeDocumentInstructions} from './document-context.ts';
import {planCodexReconciliation} from './reconciliation.ts';
import {codexPublicEvents} from './codex-events.ts';

const principal = 'local-workbench-user';
const createSchema = z.object({ name: z.string().trim().min(1).max(100), taskId:z.string().min(1).max(100).optional() }).strict();
interface Runtime { server: Awaited<ReturnType<typeof startCodexServer>>; binaryHash: string; rpc: CodexRpc; session: CodexLinkedSession; owner: NativeOwner; timer: ReturnType<typeof setInterval>; bridge?:NativeDocumentBridge;queuePaused?:boolean;cancellationShape:boolean }

/** Existing installed native runtime, thin protocol adapter; no vendor transcript writes. */
export class NativeSessions {
  readonly store: NativeSessionStore;
  private runtimes = new Map<string, Runtime>();
  private creating = false;
  private closing = false;
  private sending=new Set<string>();
  private reconciling=new Set<string>();
  private validation=new RuntimeValidationCache<Awaited<ReturnType<typeof inspectCodexRuntime>>>();
  constructor(db: DatabaseSync, private dataRoot: string, private publish: (link: string) => void,
    private documentTools?: (scopeId:string,taskId:string)=>Promise<NativeToolProvider>,private nativeWorkspace?:string) {
    this.store = new NativeSessionStore(db);
    db.exec('CREATE TABLE IF NOT EXISTS native_session_metadata (link TEXT PRIMARY KEY, name TEXT NOT NULL, runtime TEXT NOT NULL)');
    db.exec('CREATE TABLE IF NOT EXISTS native_send_contexts (link TEXT NOT NULL, message TEXT NOT NULL, body TEXT NOT NULL, prepared TEXT NOT NULL, PRIMARY KEY(link,message))');
    db.exec('CREATE TABLE IF NOT EXISTS native_reconciliations (link TEXT PRIMARY KEY, body TEXT NOT NULL)');
    this.db = db;
  }
  private db: DatabaseSync;

  get busy() {
    return this.creating || this.reconciling.size>0 || this.sending.size>0 || [...this.runtimes.keys()].some(id => {
      const link = this.store.get(id, principal);
      return Boolean(link.activeTurnId) || this.store.hasPending(id, principal) || this.runtimes.get(id)?.bridge?.busy;
    });
  }
  private summary(id: string) {
    const link = this.store.get(id, principal), row = this.db.prepare('SELECT name,runtime FROM native_session_metadata WHERE link=?').get(id);
    const metadata=row?JSON.parse(String(row.runtime)):null;
    const recovery=this.db.prepare('SELECT body FROM native_reconciliations WHERE link=?').get(id);
    const runtime=this.runtimes.get(id),connected=Boolean(runtime&&link.owner?.status==='active');
    return { ...link, name: row?.name ?? 'Native session', runtime: row ? JSON.parse(String(row.runtime)) : null,
      connected, pending: this.sending.has(id) || Boolean(runtime?.bridge?.busy) || this.store.hasPending(id, principal) || Boolean(link.activeTurnId),
      canRetire:Boolean(runtime&&link.owner?.status==='uncertain'&&!runtime.bridge?.running&&!this.sending.has(id)),
      canResume:!this.runtimes.has(id)&&Boolean(row)&&!link.owner&&!link.activeTurnId&&!this.store.hasPending(id,principal),
      canReconcile:!this.runtimes.has(id)&&Boolean(metadata?.execution)&&Boolean(link.owner||link.activeTurnId||this.store.hasPending(id,principal)),
      canInterrupt:Boolean(this.runtimes.get(id)?.cancellationShape&&link.activeTurnId&&link.owner?.status==='active'),
      reconciliation:recovery?JSON.parse(String(recovery.body)):null,
      terminalSharing: connected, documentToolsConnected: Boolean(connected&&runtime?.bridge),
      document: this.runtimes.get(id)?.bridge?.provider.document ?? metadata?.document ?? null };
  }
  list(after = 0) { const page = this.store.list(principal, { after, limit: 100 }); return { ...page, items: page.items.map(link => this.summary(link.linkId)) }; }
  events(id: string, after = 0) { return this.store.replay(id, principal, { after, limit: 100 }); }
  receipts(id: string, after = 0) { return this.store.messages(id, principal, { after, limit: 100 }); }

  async create(input: unknown) {
    const data = parseNative(createSchema, input);
    return this.open(data);
  }
  async retireUncertain(id:string,unresolvedOperations:string[]=[]){
    const link=this.store.get(id,principal),runtime=this.runtimes.get(id);
    if(this.creating||this.closing||this.reconciling.has(id)||this.sending.has(id))throw new AppError('NATIVE_STATE_CONFLICT','Wait for the current setup or dispatch before retiring a connection.',409);
    if(!runtime||link.owner?.status!=='uncertain'||link.owner.launchId!==runtime.owner.launchId||link.ownerEpoch!==runtime.owner.ownerEpoch)
      throw new AppError('NATIVE_OWNER_UNCERTAIN','Only this host\'s known fenced runtime may be retired; no other process was stopped.',409);
    if(runtime.bridge?.running||unresolvedOperations.length)throw new AppError('NATIVE_DOCUMENT_UNCERTAIN','A document write needs inspection before retiring its runtime.',409);
    this.reconciling.add(id);
    try{
      clearInterval(runtime.timer);await runtime.bridge?.close();runtime.session.disconnect();await runtime.server.stop();
      if(runtime.server.child.exitCode===null&&runtime.server.child.signalCode===null)throw new AppError('NATIVE_OWNER_UNCERTAIN','The owned process did not confirm exit; its execution state was not cleared.',409);
      if(this.runtimes.get(id)===runtime)this.runtimes.delete(id);
      this.publish(id);return {retired:true,historyRetained:true,replayed:false,requiresReconciliation:true,session:this.summary(id)};
    }finally{this.reconciling.delete(id);}
  }
  async reconcile(id:string,unresolvedOperations:string[]=[]){
    const original=this.store.get(id,principal),row=this.db.prepare('SELECT runtime FROM native_session_metadata WHERE link=?').get(id);
    if(this.creating||this.closing||this.runtimes.has(id)||this.reconciling.has(id))throw new AppError('NATIVE_STATE_CONFLICT','Close the owned connection before offline reconciliation.',409);
    if(unresolvedOperations.length)throw new AppError('NATIVE_DOCUMENT_UNCERTAIN','Inspect unresolved document writes before resuming this session.',409);
    const metadata=row?JSON.parse(String(row.runtime)):null,execution=metadata?.execution;
    if(!execution||!original.owner||execution.launchId!==original.owner.launchId||execution.ownerEpoch!==original.ownerEpoch)throw new AppError('NATIVE_OWNER_UNCERTAIN','This older link has no matching process evidence; it was not reset.',409);
    const absent=(pid:unknown)=>{
      if(!Number.isSafeInteger(pid)||Number(pid)<=0)return false;
      try{process.kill(Number(pid),0);return false;}catch(error){return (error as NodeJS.ErrnoException).code==='ESRCH';}
    };
    if(!absent(execution.serverPid)||(execution.hostPid!==process.pid&&!absent(execution.hostPid)))throw new AppError('NATIVE_OWNER_UNCERTAIN','The earlier owner may still be running; no takeover was performed.',409);
    this.reconciling.add(id);let server:Awaited<ReturnType<typeof startCodexServer>>|undefined;
    try{
      const native=await findCodexBinary(await findCodexLauncher());
      server=await startCodexServer(native.binary,original.workingDirectory);
      const response=await server.rpc.request('thread/read',{threadId:original.vendorSessionId,includeTurns:true});
      const messages=this.store.pendingMessages(id,principal),plan=planCodexReconciliation(original,messages,response);
      // Stop the inspection server before releasing the previous execution epoch.
      await server.stop();if(server.child.exitCode===null&&server.child.signalCode===null)throw new AppError('NATIVE_OWNER_UNCERTAIN','Inspection server shutdown was not confirmed.',409);
      const report={checkedAt:new Date().toISOString(),ready:plan.ready,reason:plan.reason,outcomes:plan.outcomes,originalSessionId:original.vendorSessionId,replayed:false};
      if(plan.ready)this.store.reconcileOffline(id,principal,original,messages,plan);
      this.db.prepare('INSERT INTO native_reconciliations VALUES(?,?) ON CONFLICT(link) DO UPDATE SET body=excluded.body').run(id,JSON.stringify(report));
      this.publish(id);return {...report,session:this.summary(id)};
    }catch(error){if(error instanceof AppError)throw error;throw new AppError('NATIVE_RECONCILIATION_FAILED','Original session state could not be verified; history and pending requests were retained.',409);}
    finally{await server?.stop();this.reconciling.delete(id);}
  }
  async resume(id:string){
    const link=this.store.get(id,principal);
    if(this.runtimes.has(id))return this.summary(id);
    if(link.owner||link.activeTurnId||this.store.hasPending(id,principal))
      throw new AppError('NATIVE_OWNER_UNCERTAIN','Resume requires a confirmed idle release. Interrupted requests remain inspectable and are never replayed.',409);
    const row=this.db.prepare('SELECT name,runtime FROM native_session_metadata WHERE link=?').get(id);
    if(!row)throw new AppError('NATIVE_SOURCE_MISMATCH','This link has no verified runtime metadata.',409);
    const metadata=JSON.parse(String(row.runtime));
    const base=await fs.realpath(path.join(this.dataRoot,'native-workspaces')).catch(()=>null),workspace=await fs.realpath(link.workingDirectory);
    const configured=this.nativeWorkspace?await fs.realpath(this.nativeWorkspace):null;
    if(!(base&&workspace.toLowerCase().startsWith(base.toLowerCase()+path.sep))&&workspace.toLowerCase()!==configured?.toLowerCase())throw new AppError('NATIVE_SOURCE_MISMATCH','Original workspace is outside the configured native workspace.',409);
    return this.open({name:String(row.name),...(metadata.document?{taskId:metadata.document.taskId}:{})},id);
  }
  private async open(data:z.infer<typeof createSchema>,resumeId?:string) {
    if (this.creating || this.closing || this.reconciling.size) throw new AppError('NATIVE_TURN_CONFLICT', 'Native runtime setup is already active.', 409);
    if (this.runtimes.size >= 4) throw new AppError('NATIVE_RPC_LIMIT', 'Close an idle native runtime before opening another.', 429);
    this.creating = true;
    let server: Awaited<ReturnType<typeof startCodexServer>> | undefined, rpc: CodexRpc | undefined, linkId: string | undefined;
    let provider:NativeToolProvider|undefined,bridge:NativeDocumentBridge|undefined;
    let acquiredOwner:NativeOwner|undefined;
    let setupPhase='runtime-verification';
    try {
      const evidence = path.join(this.dataRoot, 'verification'); await fs.mkdir(evidence, { recursive: true });
      const launcher=await findCodexLauncher(),native=await findCodexBinary(launcher);
      const launcherHash=createHash('sha256').update(await fs.readFile(launcher)).digest('hex');
      const validation=await this.validation.get(JSON.stringify([launcher,launcherHash,native.binary,native.binaryHash]),()=>inspectCodexRuntime(launcher,evidence,this.nativeWorkspace));
      const check=validation.value;
      if (!check.protocol.compatibleShape) throw new AppError('NATIVE_VERSION_UNSUPPORTED', 'Installed Codex protocol changed; compatibility validation is required.', 409);
      if (createHash('sha256').update(await fs.readFile(check.launcher)).digest('hex') !== check.launcherHash)
        throw new AppError('NATIVE_RUNTIME_CHANGED', 'Codex changed during validation; start a fresh explicit setup.', 409);
      const previous=resumeId?this.store.get(resumeId,principal):undefined;
      const workspace = previous?.workingDirectory??(this.nativeWorkspace?await fs.realpath(this.nativeWorkspace):path.join(this.dataRoot, 'native-workspaces', randomUUID())); await fs.mkdir(workspace, { recursive: true });
      linkId=resumeId??randomUUID();
      if(data.taskId){
        if(!this.documentTools)throw new AppError('NATIVE_TOOL_UNAVAILABLE','Document tool connection is unavailable.',409);
        provider=await this.documentTools(linkId,data.taskId);
        if(previous){
          const metadata=JSON.parse(String(this.db.prepare('SELECT runtime FROM native_session_metadata WHERE link=?').get(linkId)?.runtime));
          if(provider.document.documentId!==metadata.document?.documentId)throw new AppError('NATIVE_SOURCE_MISMATCH','Original document binding changed; the saved session was not retargeted.',409);
        }
      }
      let serverConfiguration=provider?.serverConfiguration,disabledInheritedMcp=0;
      if(serverConfiguration){
        const keep=serverConfiguration.allowedMcpServers;
        if(!keep?.length)throw new AppError('NATIVE_MCP_SCOPE','Document server configuration requires an explicit MCP allowlist.',409);
        setupPhase='effective-mcp-config';const inherited=await inspectCodexMcpConfig(native.binary,workspace),overrides=scopedCodexMcpArgs(inherited,keep);disabledInheritedMcp=overrides.length/2;
        serverConfiguration={...serverConfiguration,args:[...overrides,...serverConfiguration.args]};
      }
      setupPhase='owned-server-start';server = await startCodexServer(native.binary, workspace,serverConfiguration); rpc = server.rpc;
      if(serverConfiguration){setupPhase='verify-mcp-scope';const effective:any=await rpc.request('config/read',{includeLayers:false,cwd:workspace});assertScopedCodexMcp(effective.config?.mcp_servers,serverConfiguration.allowedMcpServers!);}
      if(previous){
        setupPhase='read-original-thread';
        const original:any=await rpc.request('thread/read',{threadId:previous.vendorSessionId,includeTurns:false});
        assertOriginalWorkspace(original.thread,previous.vendorSessionId,workspace);
      }
      setupPhase=previous?'resume-original-thread':'start-thread';
      const acknowledgement: any = await rpc.request(previous?'thread/resume':'thread/start', { cwd: workspace, sandbox: 'read-only', approvalPolicy: 'on-request', ...(previous?{threadId:previous.vendorSessionId}:{experimentalRawEvents:false}),
        ...(provider?{developerInstructions:nativeDocumentInstructions}:{}),
        ...(provider&&!provider.serverConfiguration?{dynamicTools:provider.tools.map(tool=>({name:tool.name,description:tool.description??'',inputSchema:tool.inputSchema}))}:{}) });
      if (acknowledgement.sandbox?.type !== 'readOnly') throw new AppError('NATIVE_SOURCE_MISMATCH', 'Owned Codex session did not confirm read-only permissions.', 409);
      if(previous&&(acknowledgement.thread?.id!==previous.vendorSessionId||path.resolve(acknowledgement.cwd).toLowerCase()!==path.resolve(workspace).toLowerCase()))
        throw new AppError('NATIVE_SOURCE_MISMATCH','Codex did not resume the original session and workspace. No replacement was created.',409);
      if(!previous)this.store.link(principal, { linkId, threadId: linkId, vendor: 'codex', vendorSessionId: acknowledgement.thread?.id,
        workingDirectory: workspace, ownerLink: { principalId: principal }, capabilities: { publicEvents: true, sendUserMessages: true, toolEvents: true } });
      const acquired=this.store.acquire(linkId, principal, previous?.ownerEpoch??0, 'workbench-host', randomUUID(), 60_000);
      const owner: NativeOwner = {ownerId:acquired.owner!.ownerId,launchId:acquired.owner!.launchId,ownerEpoch:acquired.ownerEpoch};
      acquiredOwner=owner;
      const queuePaused=Boolean(previous&&this.db.prepare("SELECT json_extract(runtime,'$.queuePaused') AS paused FROM native_session_metadata WHERE link=?").get(linkId)?.paused);
      this.db.prepare('INSERT INTO native_session_metadata VALUES(?,?,?) ON CONFLICT(link) DO UPDATE SET runtime=excluded.runtime').run(linkId, data.name, JSON.stringify({ version: check.version, protocolFingerprint: check.protocol.fingerprint, evidence: check.evidence, binaryHash: native.binaryHash, transport: 'authenticated-loopback',document:provider?.document??null,...(serverConfiguration?{mcpScope:{mode:'document-relay-only',disabledInheritedCount:disabledInheritedMcp}}:{}),runtimeValidationCacheHit:validation.cacheHit,queuePaused,execution:{hostPid:process.pid,serverPid:server.child.pid,launchId:owner.launchId,ownerEpoch:owner.ownerEpoch} }));
      const session = new CodexLinkedSession(this.store, rpc, linkId, principal, owner);
      session.attachCreated(acknowledgement);
      const id = linkId;
      if(provider)bridge=new NativeDocumentBridge(rpc,acknowledgement.thread.id,provider,event=>{
        // Standard MCP calls already have vendor public events; do not duplicate them.
        if(!provider?.serverConfiguration)this.store.appendEvent(id,principal,owner,{...event,vendor:'codex',vendorSessionId:acknowledgement.thread.id});
      },()=>this.publish(id),()=>this.store.get(id,principal).activeTurnId);
      session.on('publicEvent', () => this.publish(id));
      session.on('fenced', () => this.publish(id));
      const timer = setInterval(() => { try { session.heartbeat(); } catch { session.disconnect(); } }, 15_000); timer.unref();
      const runtime:Runtime = { server, binaryHash: native.binaryHash, rpc, session, owner, timer, bridge,queuePaused,cancellationShape:check.protocol.cancellationShape };
      this.runtimes.set(id, runtime);
      server.child.once('exit', () => { clearInterval(timer); session.disconnect(); if(this.runtimes.get(id)===runtime)this.runtimes.delete(id); void bridge?.close().catch(()=>{}); this.publish(id); });
      this.publish(id); return this.summary(id);
    } catch (error) {
      if(bridge)await bridge.close();else await provider?.close();rpc?.close(); await server?.stop();
      if(acquiredOwner&&linkId&&server&&(server.child.exitCode!==null||server.child.signalCode!==null)){
        const link=this.store.get(linkId,principal);
        if(!link.activeTurnId&&!this.store.hasPending(linkId,principal))this.store.release(linkId,principal,acquiredOwner);
      }
      if (error instanceof AppError) throw new AppError(error.code,`${error.message} Setup phase: ${setupPhase}.`,error.status);
      throw new AppError('NATIVE_START_FAILED', 'Native runtime setup failed; no existing conversation was replaced.', 503);
    } finally { this.creating = false; }
  }

  approvals(id:string){this.store.get(id,principal);return this.runtimes.get(id)?.bridge?.pending()??[];}
  async confirm(id:string,input:unknown){
    const link=this.store.get(id,principal),bridge=this.runtimes.get(id)?.bridge;
    if(!bridge)throw new AppError('NATIVE_TOOL_UNAVAILABLE','This session has no connected document tools.',409);
    const data=parseNative(z.object({callId:z.string().min(1).max(200),allow:z.boolean()}).strict(),input);
    if(data.allow&&link.owner?.status!=='active')throw new AppError('NATIVE_OWNER_UNCERTAIN','This connection lost execution ownership; old approvals cannot issue a document call.',409);
    return bridge.confirm(data.callId,data.allow);
  }
  document(id:string){return this.summary(id).document;}
  assertIdle(id:string){
    const link=this.store.get(id,principal);
    if(link.activeTurnId||this.store.hasPending(id,principal)||this.sending.has(id)||this.runtimes.get(id)?.bridge?.busy)
      throw new AppError('NATIVE_TURN_CONFLICT','Wait for this document turn before restoring an edit.',409);
  }
  proxyCall(id:string,input:unknown){
    const link=this.store.get(id,principal),bridge=this.runtimes.get(id)?.bridge;
    if(!bridge||!link.activeTurnId||link.owner?.status!=='active')throw new AppError('NATIVE_TOOL_UNAVAILABLE','No active owned document turn.',409);
    const data=parseNative(z.object({callId:z.string().min(1).max(200),tool:z.enum(['office_live','office_file']),args:z.record(z.unknown())}).strict(),input);
    return bridge.requestMcp(data.callId,data.tool,data.args,link.activeTurnId);
  }
  cancelProxy(id:string,callId:string){this.runtimes.get(id)?.bridge?.cancel(callId);}

  async terminal(id: string) {
    const link = this.store.get(id, principal), runtime = this.runtimes.get(id);
    if (!runtime || link.owner?.status !== 'active')
      throw new AppError('NATIVE_OWNER_UNCERTAIN', 'Connect only to an active, verified owned session.', 409);
    if (createHash('sha256').update(await fs.readFile(runtime.server.binary)).digest('hex') !== runtime.binaryHash)
      throw new AppError('NATIVE_RUNTIME_CHANGED', 'Codex was upgraded while this session was running; validate continuation before attaching another terminal.', 409);
    const clientHome = path.join(this.dataRoot, 'native-terminal-homes', randomUUID());
    await fs.mkdir(clientHome, { recursive: true });
    return { endpoint: runtime.server.endpoint, token: runtime.server.token, binary: runtime.server.binary,
      threadId: link.vendorSessionId, workspace: link.workingDirectory, clientHome };
  }

  async interrupt(id:string){
    const link=this.store.get(id,principal),runtime=this.runtimes.get(id);
    if(!runtime||link.owner?.status!=='active'||!link.activeTurnId)throw new AppError('NATIVE_TURN_CONFLICT','Only the current verified active turn can be interrupted.',409);
    if(!runtime.cancellationShape)throw new AppError('NATIVE_VERSION_UNSUPPORTED','This installed Codex does not advertise the supported cancellation/queue APIs.',409);
    if(runtime.bridge?.running)throw new AppError('NATIVE_DOCUMENT_BUSY','A document tool is already executing; wait for its receipt before cancelling the model turn.',409);
    for(const approval of runtime.bridge?.pending()??[])runtime.bridge!.cancel(approval.callId);
    await runtime.rpc.request('turn/interrupt',{threadId:link.vendorSessionId,turnId:link.activeTurnId});
    runtime.queuePaused=true;this.db.prepare("UPDATE native_session_metadata SET runtime=json_set(runtime,'$.queuePaused',1) WHERE link=?").run(id);
    const result:any=await runtime.rpc.request('thread/read',{threadId:link.vendorSessionId,includeTurns:true});assertOriginalWorkspace(result.thread,link.vendorSessionId,link.workingDirectory);
    const turn=result.thread.turns?.find((t:any)=>t.id===link.activeTurnId),cancelled:string[]=[];
    if(turn?.status==='interrupted'&&Array.isArray(turn.items)&&turn.items.length===0&&result.thread.status?.type==='idle'){
      const queue=z.object({data:z.array(z.unknown()).max(100),nextCursor:z.string().nullable()}).parse(await runtime.rpc.request('thread/queue/list',{threadId:link.vendorSessionId,limit:100}));
      if(!queue.data.length&&queue.nextCursor===null){
        for(const event of codexPublicEvents(link.vendorSessionId,{method:'turn/completed',params:{threadId:link.vendorSessionId,turn}}))this.store.appendEvent(id,principal,runtime.owner,event);
        // Explicit cancellation is not evidence that a message ran or a document rolled back.
        for(const message of this.store.pendingMessages(id,principal))if(message.state==='accepted'&&message.vendorRequestId&&message.execution?.launchId===runtime.owner.launchId&&message.execution.ownerEpoch===runtime.owner.ownerEpoch){
          this.store.recordOutcome(id,principal,runtime.owner,{vendor:'codex',vendorSessionId:link.vendorSessionId},message.messageId,'cancelled',message.vendorRequestId);cancelled.push(message.messageId);
        }
      }
    }
    this.publish(id);return {requested:true,turnId:link.activeTurnId,documentRollback:false,cancelledMessages:cancelled};
  }

  async send(id: string, input: unknown) {
    const runtime = this.runtimes.get(id);
    if (!runtime) { this.store.get(id, principal); throw new AppError('NATIVE_OWNER_UNCERTAIN', 'Native session is offline. Existing history is retained; do not create a replacement implicitly.', 409); }
    const message = parseNative(z.object({ messageId: z.string().min(1).max(200), text: z.string().min(1).max(32768),selectionId:z.string().min(1).max(100).optional() }).strict(), input);
    const body=JSON.stringify(message),previous=this.db.prepare('SELECT body,prepared FROM native_send_contexts WHERE link=? AND message=?').get(id,message.messageId);
    if(previous){
      if(previous.body!==body)throw new AppError('NATIVE_ID_REUSED','Message ID already belongs to different text or selection.',409);
      const result=await runtime.session.send(message.messageId,String(previous.prepared));this.publish(id);return result;
    }
    if(this.sending.has(id)||this.store.get(id,principal).activeTurnId||this.store.hasPending(id,principal))throw new AppError('NATIVE_TURN_CONFLICT','Wait for the active or uncertain turn before sending.',409);
    this.sending.add(id);
    try{
      if(message.selectionId&&!runtime.bridge?.provider.prepareMessage)throw new AppError('SELECTION_SCOPE','This session has no live selection connection.',409);
      const prepared=await runtime.bridge?.provider.prepareMessage?.(message.text,message.selectionId)??{text:message.text,apply:()=>{}};
      if(this.store.get(id,principal).activeTurnId||this.store.hasPending(id,principal))throw new AppError('NATIVE_TURN_CONFLICT','The native session became active while preparing this message.',409);
      if(prepared.text.length>32768)throw new AppError('NATIVE_INVALID_INPUT','Message plus selection context exceeds32768 characters.');
      this.db.prepare('INSERT INTO native_send_contexts VALUES(?,?,?,?)').run(id,message.messageId,body,prepared.text);
      prepared.apply();
      const result=await runtime.session.send(message.messageId,prepared.text);
      if(runtime.queuePaused&&result.state==='accepted'&&result.vendorRequestId){
        const link=this.store.get(id,principal),queue=z.object({data:z.array(z.object({id:z.string(),clientUserMessageId:z.string(),input:z.array(z.object({type:z.string(),text:z.string().optional()}).passthrough())})).max(100),nextCursor:z.string().nullable()}).parse(await runtime.rpc.request('thread/queue/list',{threadId:link.vendorSessionId,limit:100}));
        const entry=queue.data.find(q=>q.id===result.vendorRequestId&&q.clientUserMessageId===message.messageId);
        if(queue.data.length!==1||queue.nextCursor!==null||!entry||entry.input.length!==1||entry.input[0].type!=='text'||entry.input[0].text!==prepared.text)throw new AppError('NATIVE_DISPATCH_UNCERTAIN','New queued input or other waiting submissions require verification; none were resent or started.',409);
        // Resume only this newly submitted input, never an older unknown queue item.
        runtime.queuePaused=false;this.db.prepare("UPDATE native_session_metadata SET runtime=json_set(runtime,'$.queuePaused',0) WHERE link=?").run(id);
        await runtime.rpc.request('thread/queue/start',{threadId:link.vendorSessionId,queuedSubmissionId:entry.id});
      }
      this.publish(id);return result;
    }finally{this.sending.delete(id);}
  }

  async close(id: string) {
    const runtime = this.runtimes.get(id); this.store.get(id, principal);
    if (!runtime) return { closed: true, historyRetained: true };
    const link = this.store.get(id, principal);
    if (this.sending.has(id) || link.activeTurnId || this.store.hasPending(id, principal) || runtime.bridge?.busy)
      throw new AppError('NATIVE_TURN_CONFLICT', 'An active or uncertain native request prevents idle shutdown.', 409);
    await this.stopRuntime(runtime,id); this.runtimes.delete(id); this.publish(id);
    return { closed: true, historyRetained: true };
  }

  private async stopRuntime(runtime: Runtime,id:string) {
    clearInterval(runtime.timer);await runtime.bridge?.close();runtime.session.disconnect(); await runtime.server.stop();
    // Release only after the owned process has stopped; unknown dispatches stay fenced.
    if(runtime.server.child.exitCode===null&&runtime.server.child.signalCode===null)
      throw new AppError('NATIVE_OWNER_UNCERTAIN','Owned runtime has not confirmed shutdown; no release was issued.',409);
    const link=this.store.get(id,principal);
    if(!link.activeTurnId&&!this.store.hasPending(id,principal))this.store.release(id,principal,runtime.owner);
  }
  async stopAll() { this.closing = true; for (const [id,runtime] of this.runtimes) await this.stopRuntime(runtime,id); this.runtimes.clear(); }
}
