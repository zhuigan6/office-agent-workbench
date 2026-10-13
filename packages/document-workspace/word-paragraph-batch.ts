import {z} from 'zod';
import {AppError,type Operation} from '../contracts/index.ts';
import {selectionSchema} from '../contracts/selection.ts';
import type {DocumentBroker} from './broker.ts';
import {digest} from './store.ts';
import {replaceWordSelection,restoreWordReplacement} from './word-replace.ts';
import {inDocumentLane} from './lane.ts';
export const wordParagraphBatchSchema=z.object({operationId:z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),selection:selectionSchema,paragraphs:z.array(z.string().max(2000).refine(v=>!/[\u0000-\u001f\u2028\u2029]/.test(v))).min(1).max(20)}).strict().superRefine((v,c)=>{
  if(v.selection.kind!=='word'||v.selection.storyType!==1||v.selection.cell||v.selection.end<=v.selection.start||v.selection.end-v.selection.start>2000||v.paragraphs.some(p=>!p.length)||v.paragraphs.join('\r').length>2000)c.addIssue({code:'custom',message:'Use complete ordinary body paragraphs, nonempty replacements, unchanged paragraph count and at most2000 characters.'});
});
const step=(op:Operation)=>({id:op.id,kind:op.kind,status:op.status,result:{verified:(op.result as any)?.verified===true}});
export async function replaceWordParagraphBatch(broker:DocumentBroker,documentId:string,input:unknown){
  const data=wordParagraphBatchSchema.parse(input);
  if(data.selection.documentId!==documentId)throw new AppError('SELECTION_SCOPE','Selection belongs to another document.',403);
  const started=broker.store.begin(data.operationId,documentId,'word.paragraph.batch',data);if(!started.fresh)return broker.inFlight.get(data.operationId)??started.operation;
  return inDocumentLane(broker,documentId,data.operationId,async lane=>{
    const children:Operation[]=[];let current:any,before:any,verifying=false;
    const result=()=>({before,after:current,children:children.map(step),atomic:false,restoreAvailable:!verifying&&!!current&&children.some(o=>o.status==='applied')&&children.every(o=>o.status!=='unknown')});
    try{
      const host=lane.host(documentId);if(host.binding.kind!=='word'||!host.binding.capabilities.includes('writeText'))throw new AppError('HOST_KIND','Writable Word is required.');
      before=await host.request('readWordParagraphBatch',{selection:data.selection,verifyReference:true});current=before;
      if(before.contentHash!==data.selection.contentHash)return broker.store.updateOperation(data.operationId,'conflict',{code:'REVISION_CONFLICT'});
      if(before.items.length!==data.paragraphs.length)throw new AppError('PARAGRAPH_COUNT','Provide one replacement per referenced paragraph; do not insert/delete paragraphs.');
      const deltas=data.paragraphs.map((text,index)=>text.length-before.items[index].text.length);
      if(data.selection.kind!=='word'||data.selection.end-data.selection.start+deltas.reduce((n,d)=>n+d,0)>2000)throw new AppError('PARAGRAPH_LIMIT','The new selected range exceeds2000 characters.');
      // Shrinking edits first keep intermediate captures within the same size cap.
      const order=data.paragraphs.map((_,index)=>index).sort((a,b)=>deltas[a]-deltas[b]);
      broker.store.updateOperation(data.operationId,'running',result());
      for(const index of order){
        const text=data.paragraphs[index];
        const probe=await host.request('readWordParagraphBatch',{selection:current.selection,verifyReference:true});
        if(probe.contentHash!==current.contentHash)throw new AppError('REVISION_CONFLICT','Referenced paragraphs changed.');
        const selection={...probe.items[index].selection,documentId},child=await replaceWordSelection(lane,documentId,{operationId:'paragraph_step_'+digest([data.operationId,index]).slice(0,48),selection,text});children.push(child);
        if(child.status!=='applied')return broker.store.updateOperation(data.operationId,child.status==='unknown'?'unknown':'failed',{...result(),verified:false,code:'PARTIAL_BATCH'});
        verifying=true;const r=child.result as any,delta=text.length-probe.items[index].text.length;
        const next=await host.request('readWordParagraphBatch',{selection:{...current.selection,end:current.selection.end+delta}});
        if(next.documentHash!==r.after.documentHash||next.items.length!==probe.items.length||next.items.some((p:any,i:number)=>p.paragraphHash!==(i===index?r.after.paragraph.contentHash:probe.items[i].paragraphHash)))throw new AppError('REVISION_CONFLICT','Batch readback detected another paragraph change.');
        current=next;verifying=false;broker.store.updateOperation(data.operationId,'running',result());
      }
      return broker.store.updateOperation(data.operationId,'applied',{...result(),verified:true,revision:current.contentHash,code:'VERIFIED'});
    }catch(error){return broker.store.updateOperation(data.operationId,verifying||children.some(o=>o.status==='unknown')?'unknown':!children.length&&error instanceof Error&&error.message.includes('REVISION_CONFLICT')?'conflict':'failed',{...result(),verified:false,code:'BATCH_STOPPED',message:error instanceof Error?error.message:String(error)});}
  });
}
export async function restoreWordParagraphBatch(broker:DocumentBroker,id:string){
  const original=broker.store.getOperation(id),r=original?.result as any;
  if(!original||original.kind!=='word.paragraph.batch'||!r?.restoreAvailable||id.startsWith('restore_'))throw new AppError('RECOVERY_UNAVAILABLE','Known paragraph steps are required.');
  const restoreId='restore_'+digest(id).slice(0,48),started=broker.store.begin(restoreId,original.documentId,'word.paragraph.batch.restore',{originalId:id});if(!started.fresh)return broker.inFlight.get(restoreId)??started.operation;
  return inDocumentLane(broker,original.documentId,restoreId,async lane=>{
    const restored:Operation[]=[];
    try{
      const now=await lane.host(original.documentId).request('readWordParagraphBatch',{selection:r.after.selection,verifyReference:true});
      if(now.contentHash!==r.after.contentHash)throw new AppError('REVISION_CONFLICT','Paragraph batch changed after editing.');
      const records=r.children.map((c:any)=>broker.store.getOperation(c.id));
      if(records.some((c:Operation|undefined,i:number)=>!c||c.documentId!==original.documentId||c.kind!=='word.replace'||c.status==='unknown'||c.status!==r.children[i].status))throw new AppError('RECOVERY_UNAVAILABLE','Paragraph journal is incomplete.');
      for(const child of records.filter((c:Operation)=>c.status==='applied').reverse()){
        const op=await restoreWordReplacement(lane,child.id);restored.push(op);broker.store.updateOperation(restoreId,'running',{children:restored.map(step),atomic:false});
        if(op.status!=='applied')return broker.store.updateOperation(restoreId,op.status==='unknown'?'unknown':'conflict',{children:restored.map(step),verified:false,atomic:false,code:'PARTIAL_RECOVERY'});
      }
      return broker.store.updateOperation(restoreId,'applied',{children:restored.map(step),verified:true,atomic:false,code:'VERIFIED'});
    }catch(error){return broker.store.updateOperation(restoreId,restored.length?'unknown':'conflict',{children:restored.map(step),verified:false,atomic:false,message:error instanceof Error?error.message:String(error)});}
  });
}
