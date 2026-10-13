import {createHash} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {z} from 'zod';
import {AppError} from '../contracts/index.ts';
import {sanitizeNativeData} from '../contracts/native-session.ts';
import type {CodexRpc,CodexServerRequest} from './codex-rpc.ts';

export interface NativeToolProvider {
  document: {taskId:string;documentId:string;name:string};
  tools: {name:string;description?:string;inputSchema:Record<string,unknown>}[];
  call(name:string,args:Record<string,unknown>):Promise<any>;
  close():Promise<void>;
  prepareMessage?(text:string,selectionId?:string):Promise<{text:string;apply:()=>void}>;
  serverConfiguration?:{args:string[];env:Record<string,string>;allowedMcpServers?:string[]};
}
export async function connectDocumentTools(document:NativeToolProvider['document'],command:string,args:string[],env:Record<string,string>,revoke:()=>void):Promise<NativeToolProvider>{
  const transport=new StdioClientTransport({command,args,env,stderr:'ignore'});
  const client=new Client({name:'office-workbench-native-bridge',version:'0.1.0-alpha.2'});
  try{
    await client.connect(transport);const listed=await client.listTools();
    const tools=listed.tools.filter(tool=>['office_live','office_file'].includes(tool.name));
    if(!tools.length||tools.length!==listed.tools.length)throw new AppError('NATIVE_TOOL_SCOPE','Expected only the scoped Workbench document tools.',409);
    return {document,tools,call:(name,arguments_)=>client.callTool({name,arguments:arguments_},undefined,{timeout:120000}),
      async close(){try{await client.close();}finally{revoke();}}};
  }catch(error){try{await client.close();}finally{revoke();}throw error;}
}

const requestSchema=z.object({threadId:z.string().min(1).max(200),turnId:z.string().min(1).max(200),callId:z.string().min(1).max(200),
  namespace:z.string().nullable().optional(),tool:z.enum(['office_live','office_file']),arguments:z.record(z.unknown())}).strict();
type Response={success:boolean;contentItems:{type:'inputText';text:string}[]};
interface Call {request:z.infer<typeof requestSchema>;rpcIds:Set<string|number>;fingerprint:string;state:'pending'|'running'|'completed'|'denied'|'failed';response?:Response;waiters:((response:Response)=>void)[]}

/** Translate vendor tool calls to the existing MCP client; approval is per fixed call. */
export class NativeDocumentBridge {
  private calls=new Map<string,Call>();
  private stopped=false;
  constructor(private rpc:CodexRpc,private threadId:string,readonly provider:NativeToolProvider,
    private record:(event:{kind:'tool.call'|'tool.result';vendorEventId:string;toolCallId:string;name?:string;data?:unknown;text?:string})=>void,
    private changed:()=>void,private activeTurn?:()=>string|null){rpc.on('serverRequest',this.receive);}
  get busy(){return [...this.calls.values()].some(call=>['pending','running'].includes(call.state));}
  get running(){return [...this.calls.values()].some(call=>call.state==='running');}
  pending(){return [...this.calls.values()].filter(call=>call.state==='pending').map(call=>({callId:call.request.callId,turnId:call.request.turnId,
    tool:call.request.tool,arguments:structuredClone(call.request.arguments),document:this.provider.document}));}
  private receive=(raw:CodexServerRequest)=>{
    if(raw.method!=='item/tool/call'){this.rpc.rejectRequest(raw.id);return;}
    const parsed=requestSchema.safeParse(raw.params);
    if(this.stopped||!parsed.success||parsed.data.threadId!==this.threadId||parsed.data.namespace||
      !this.provider.tools.some(tool=>tool.name===parsed.data.tool)||Buffer.byteLength(JSON.stringify(parsed.data.arguments))>32768){
      this.rpc.respond(raw.id,this.failure('Document tool request is outside the bound scope.'));return;
    }
    const request=structuredClone(parsed.data),fingerprint=createHash('sha256').update(JSON.stringify(request)).digest('hex');
    try{sanitizeNativeData(request.arguments);}catch{this.rpc.respond(raw.id,this.failure('Tool arguments exceed the supported document structure.'));return;}
    const previous=this.calls.get(request.callId);
    if(previous){
      if(previous.fingerprint!==fingerprint){this.rpc.respond(raw.id,this.failure('Tool call identity was reused with different arguments.'));return;}
      if(previous.response)this.rpc.respond(raw.id,previous.response);else previous.rpcIds.add(raw.id);return;
    }
    if(this.calls.size>=100){this.rpc.respond(raw.id,this.failure('This document session reached its tool-call limit; finish before reconnecting.'));return;}
    this.calls.set(request.callId,{request,rpcIds:new Set([raw.id]),fingerprint,state:'pending',waiters:[]});
    const eventId=createHash('sha256').update(request.callId).digest('hex');
    this.record({kind:'tool.call',vendorEventId:'dynamic-call-'+eventId,toolCallId:request.callId,name:request.tool,data:request.arguments});
    this.changed();
  };
  requestMcp(callId:string,tool:string,args:Record<string,unknown>,turnId:string):Promise<Response>{
    const request=requestSchema.parse({threadId:this.threadId,turnId,callId,tool,arguments:args});
    if(this.stopped||!this.provider.tools.some(item=>item.name===tool)||Buffer.byteLength(JSON.stringify(args))>32768)
      throw new AppError('NATIVE_TOOL_SCOPE','Document tool request is outside the bound scope.',403);
    sanitizeNativeData(args);
    const fingerprint=createHash('sha256').update(JSON.stringify(request)).digest('hex'),existing=this.calls.get(callId);
    if(existing){
      if(existing.fingerprint!==fingerprint)throw new AppError('NATIVE_ID_REUSED','Call ID belongs to different parameters.',409);
      if(existing.response)return Promise.resolve(existing.response);
      return new Promise(resolve=>existing.waiters.push(resolve));
    }
    if(this.calls.size>=100)throw new AppError('NATIVE_RPC_LIMIT','Document session tool limit reached.',429);
    const call:Call={request,rpcIds:new Set(),fingerprint,state:'pending',waiters:[]};this.calls.set(callId,call);
    const id=createHash('sha256').update(callId).digest('hex');
    this.record({kind:'tool.call',vendorEventId:'mcp-approval-'+id,toolCallId:callId,name:tool,data:args});
    this.changed();return new Promise(resolve=>call.waiters.push(resolve));
  }
  cancel(callId:string){
    const call=this.calls.get(callId);if(!call||call.state!=='pending')return;
    void this.confirm(callId,false);
  }
  async confirm(callId:string,allow:boolean){
    const call=this.calls.get(callId);
    if(this.stopped||!call)throw new AppError('NATIVE_APPROVAL_EXPIRED','Native tool approval is no longer pending.',409);
    if(call.state!=='pending')return {state:call.state,replayed:true};
    if(allow&&this.activeTurn&&this.activeTurn()!==call.request.turnId)throw new AppError('NATIVE_APPROVAL_EXPIRED','The originating turn is no longer active; no operation was executed.',409);
    call.state=allow?'running':'denied';this.changed();
    let response:Response;
    if(!allow)response=this.failure('The user denied this document tool call. No operation was executed.');
    else{
      try{
        const result=await this.provider.call(call.request.tool,structuredClone(call.request.arguments));
        const text=(result.content??[]).filter((part:any)=>part.type==='text'&&typeof part.text==='string').map((part:any)=>part.text).join('\n');
        if(Buffer.byteLength(text)>2*1024*1024)throw Error('Oversized result');
        response={success:result.isError!==true,contentItems:[{type:'inputText',text:text||'Document tool returned no text.'}]};
        call.state=response.success?'completed':'failed';
      }catch{
        call.state='failed';response=this.failure('Document tool result could not be confirmed. Inspect the existing operation record before another write; do not resend automatically.');
      }
    }
    call.response=response;
    const eventId=createHash('sha256').update(call.request.callId).digest('hex');
    this.record({kind:'tool.result',vendorEventId:'dynamic-result-'+eventId,toolCallId:call.request.callId,
      text:response.contentItems[0].text.slice(0,8192),data:{state:call.state,success:response.success}});
    for(const id of call.rpcIds){try{this.rpc.respond(id,response);}catch{/* Disconnection leaves the operation record authoritative. */}}
    call.rpcIds.clear();for(const resolve of call.waiters)resolve(response);call.waiters=[];this.changed();return {state:call.state};
  }
  private failure(text:string):Response{return {success:false,contentItems:[{type:'inputText',text}]};}
  async close(){
    if(this.stopped)return;
    this.stopped=true;this.rpc.off('serverRequest',this.receive);
    for(const call of this.calls.values())if(call.state==='pending'){
      const response=this.failure('Document session closed before approval.');
      for(const id of call.rpcIds){try{this.rpc.respond(id,response);}catch{}}
      for(const resolve of call.waiters)resolve(response);call.waiters=[];
    }
    await this.provider.close();
  }
}
