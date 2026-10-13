import {z} from 'zod';
import {AppError} from '../contracts/index.ts';
import {nativeIdSchema,type NativeSessionLink,type NativeOutboundMessage,type NativePublicEvent} from '../contracts/native-session.ts';
import {assertOriginalWorkspace} from './workspace-identity.ts';
import {codexPublicEvents} from './codex-events.ts';

const snapshotSchema=z.object({thread:z.object({id:nativeIdSchema,cwd:z.string(),status:z.object({type:z.enum(['idle','notLoaded','active','systemError'])}).passthrough(),
  turns:z.array(z.object({id:nativeIdSchema,status:z.enum(['completed','failed','interrupted','inProgress']),itemsView:z.string().optional(),items:z.array(z.object({id:nativeIdSchema,type:z.string()}).passthrough()).max(2000)}).passthrough()).max(1000)}).passthrough()}).passthrough();
export interface ReconciliationPlan {
  ready:boolean;reason:string;
  outcomes:{messageId:string;turnId:string;state:'completed'|'interrupted'}[];
  events:NativePublicEvent[];
}

/** Only original-session RPC evidence, never text search or a permission to resend. */
export function planCodexReconciliation(link:NativeSessionLink,messages:NativeOutboundMessage[],input:unknown):ReconciliationPlan{
  if(Buffer.byteLength(JSON.stringify(input))>8*1024*1024)throw new AppError('NATIVE_RPC_LIMIT','Reconciliation snapshot exceeds the supported size.',409);
  const parsed=snapshotSchema.safeParse(input);if(!parsed.success)throw new AppError('NATIVE_VERSION_UNSUPPORTED','Installed Codex reconciliation response needs compatibility validation.',409);
  const thread=parsed.data.thread;assertOriginalWorkspace(thread,link.vendorSessionId,link.workingDirectory);
  const blocked=(reason:string):ReconciliationPlan=>({ready:false,reason,outcomes:[],events:[]});
  if(['active','systemError'].includes(thread.status.type)||thread.turns.some(t=>t.status==='inProgress'))return blocked('VENDOR_TURN_UNFINISHED');
  if(new Set(thread.turns.map(t=>t.id)).size!==thread.turns.length)return blocked('AMBIGUOUS_TURN_ID');
  if(messages.some(m=>m.state==='queued'))return blocked('UNDISPATCHED_MESSAGE_REQUIRES_DECISION');
  const outcomes:ReconciliationPlan['outcomes']=[],needed=new Set<string>();
  if(link.activeTurnId){
    if(!thread.turns.some(t=>t.id===link.activeTurnId))return blocked('ACTIVE_TURN_NOT_FOUND');
    needed.add(link.activeTurnId);
  }
  for(const message of messages){
    const matches=thread.turns.flatMap(turn=>turn.items.filter(item=>item.type==='userMessage'&&item.clientId===message.messageId).map(item=>({turn,item})));
    if(matches.length!==1)return blocked('MESSAGE_ID_NOT_CONFIRMED');
    const {turn,item}=matches[0];
    if(turn.itemsView&&turn.itemsView!=='full')return blocked('PARTIAL_TURN_SNAPSHOT');
    const content=z.array(z.object({type:z.literal('text'),text:z.string()}).passthrough()).safeParse(item.content);
    if(!content.success||content.data.map(c=>c.text).join('\n')!==message.text)return blocked('MESSAGE_CONTENT_MISMATCH');
    outcomes.push({messageId:message.messageId,turnId:turn.id,state:turn.status==='completed'?'completed':'interrupted'});needed.add(turn.id);
  }
  const events:NativePublicEvent[]=[];
  for(const turn of thread.turns.filter(t=>needed.has(t.id))){
    if(turn.itemsView&&turn.itemsView!=='full')return blocked('PARTIAL_TURN_SNAPSHOT');
    events.push(...codexPublicEvents(link.vendorSessionId,{method:'turn/started',params:{threadId:link.vendorSessionId,turn}}));
    for(const item of turn.items){
      if(!['userMessage','agentMessage'].includes(item.type))continue;
      events.push(...codexPublicEvents(link.vendorSessionId,{method:'item/completed',params:{threadId:link.vendorSessionId,turnId:turn.id,item}}));
    }
    events.push(...codexPublicEvents(link.vendorSessionId,{method:'turn/completed',params:{threadId:link.vendorSessionId,turn}}));
  }
  return {ready:true,reason:'VERIFIED_TERMINAL_STATE',outcomes,events};
}
