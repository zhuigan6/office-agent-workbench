import {createHash} from 'node:crypto';
import {canonical} from '../contracts/index.ts';

type Entry={turn:string;title:string;input:unknown;hash:string;seen:number;redacted:boolean;conflict:boolean;observed:boolean};
const validId=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\x00-\x1f]/.test(value);
function presentation(value:any,depth=0):{value:unknown;redacted:boolean}{
  if(depth>20)throw Error('Permission input nesting exceeded');
  if(!value||typeof value!=='object')return {value,redacted:false};
  let redacted=false;
  const entries=Object.entries(value).map(([key,item])=>{
    if(/(?:^|[-_])(?:api[-_]?key|access[-_]?token|refresh[-_]?token|auth[-_]?token|token|password|secret|authorization|credentials?)$/i.test(key)){redacted=true;return [key,'[REDACTED]'] as const;}
    const next=presentation(item,depth+1);redacted ||= next.redacted;return [key,next.value] as const;
  });
  return {value:Array.isArray(value)?entries.map(([,item])=>item):Object.fromEntries(entries),redacted};
}

/** Exact upstream permission IDs, never inferred from nearby tool names/history. */
export class ManagedPermissionDetails {
  private entries=new Map<string,Entry>();
  constructor(private now:()=>number=Date.now){}
  capture(event:any){
    if(event?.name==='core.events.disconnected'){this.invalidateObserved();return false;}
    if(event?.name==='turn.completed'&&validId(event.data?.conversation_id)){this.complete(event.data.conversation_id,event.data.turn_id);return false;}
    if(event?.name!=='message.stream'||event.data?.type!=='acp_permission')return false;
    const {conversation_id:conversation,turn_id:turn}=event.data,call=event.data.data?.tool_call;
    if(!validId(conversation)||!validId(turn)||!validId(call?.tool_call_id)||!validId(call?.title)||call.raw_input===undefined)return false;
    try{
      const raw=canonical(call.raw_input);if(Buffer.byteLength(raw)>262144)return false;
      const hash=createHash('sha256').update(raw).digest('hex'),key=JSON.stringify([conversation,call.tool_call_id]),old=this.entries.get(key),input=presentation(JSON.parse(raw));
      if(old&&(old.hash!==hash||old.turn!==turn||old.title!==call.title)){old.conflict=true;return false;}
      this.entries.set(key,{turn,title:call.title,input:input.value,hash,seen:this.now(),redacted:input.redacted,conflict:old?.conflict??false,observed:true});
      while(this.entries.size>256)this.entries.delete(this.entries.keys().next().value!);
      return true;
    }catch{return false;}
  }
  enrich(confirmation:any,conversation:string,turn:string|null){
    const entry=this.entries.get(JSON.stringify([conversation,confirmation.call_id]));
    if(!entry)return {...confirmation,permissionDetails:{state:'unavailable'}};
    if(entry.conflict)return {...confirmation,canAllow:false,permissionDetails:{state:'conflict'}};
    if(!entry.observed||!turn||entry.turn!==turn||entry.title!==confirmation.title||this.now()-entry.seen>12*3600000)return {...confirmation,permissionDetails:{state:'unavailable'}};
    return {...confirmation,permissionDetails:{state:'observed',turnId:entry.turn,input:structuredClone(entry.input),redacted:entry.redacted}};
  }
  complete(conversation:string,turn?:string){for(const [key,value] of this.entries)if(JSON.parse(key)[0]===conversation&&(!turn||value.turn===turn))this.entries.delete(key);}
  invalidateObserved(){for(const value of this.entries.values())value.observed=false;}
  clear(){this.entries.clear();}
}
