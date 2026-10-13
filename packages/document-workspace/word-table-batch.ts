import {z} from 'zod';
import {AppError,type Operation} from '../contracts/index.ts';
import {DocumentBroker} from './broker.ts';
import {digest} from './store.ts';
import {replaceWordSelection,restoreWordReplacement} from './word-replace.ts';
import {formatWordSelection,restoreWordFormat} from './word-format.ts';
import {wordFontSchema,wordCellParagraphSchema} from '../contracts/word-format.ts';
import {inDocumentLane} from './lane.ts';
import {wordTableReferenceSchema} from '../contracts/word-table.ts';
export {wordTableReferenceSchema} from '../contracts/word-table.ts';

export const wordTableBatchSchema=z.object({operationId:z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),reference:wordTableReferenceSchema,
  edits:z.array(z.object({row:z.number().int().min(1).max(20),column:z.number().int().min(1).max(20),text:z.string().min(1).max(2000).refine(t=>!/[\u0000-\u001f\u2028\u2029]/.test(t)).optional(),font:wordFontSchema.optional(),paragraph:wordCellParagraphSchema.optional()}).strict().refine(v=>v.text!==undefined||v.font!==undefined||v.paragraph!==undefined)).min(1).max(20)}).strict().superRefine((v,c)=>{
  if(new Set(v.edits.map(e=>`${e.row}:${e.column}`)).size!==v.edits.length||v.edits.some(e=>e.row>v.reference.rows||e.column>v.reference.columns))c.addIssue({code:'custom',message:'Use unique cells inside the referenced table dimensions.'});
});
const summary=(op:Operation)=>({id:op.id,kind:op.kind,status:op.status,result:{verified:(op.result as any)?.verified===true}});

export async function editWordTableBatch(broker:DocumentBroker,documentId:string,input:unknown){
  const data=wordTableBatchSchema.parse(input),started=broker.store.begin(data.operationId,documentId,'word.table.batch',data);
  if(!started.fresh)return broker.inFlight.get(data.operationId)??started.operation;
  return inDocumentLane(broker,documentId,data.operationId,async lane=>{
    const children:Operation[]=[],before:any[]=[];let reference=data.reference;
    const result=()=>({before:before[0]??null,children:children.map(summary),atomic:false,reference,restoreAvailable:children.some(c=>c.status==='applied')&&children.every(c=>c.status!=='unknown')});
    try{
      const host=lane.host(documentId);if(host.binding.kind!=='word'||!host.binding.capabilities.includes('writeText'))throw new AppError('HOST_KIND','Writable Word is required.');
      broker.store.updateOperation(data.operationId,'running',{children:[],atomic:false});
      // Validate all cells and the initial revision before the first side effect.
      for(const edit of data.edits){
        const probe=await host.request('readWordBatchCell',{reference,row:edit.row,column:edit.column});
        if(edit.font||edit.paragraph)await host.request('readWordFormat',{selection:probe.selection,fields:Object.keys(edit.font??{}),paragraphFields:Object.keys(edit.paragraph??{})});
        if(!before.length)before.push(probe.snapshot.table);
      }
      for(const [index,edit] of data.edits.entries()){
        let probe=await host.request('readWordBatchCell',{reference,row:edit.row,column:edit.column});
        for(const action of ['text','font'] as const){
          if(action==='text'?edit.text===undefined:edit.font===undefined&&edit.paragraph===undefined)continue;
          const operationId='table_step_'+digest([data.operationId,index,action]).slice(0,48);
          probe.selection={...probe.selection,documentId};
          const child=action==='text'?await replaceWordSelection(lane,documentId,{operationId,selection:probe.selection,text:edit.text}):await formatWordSelection(lane,documentId,{operationId,selection:probe.selection,font:edit.font,paragraph:edit.paragraph});
          children.push(child);
          if(child.status!=='applied')return broker.store.updateOperation(data.operationId,child.status==='unknown'?'unknown':'failed',{...result(),verified:false,code:'PARTIAL_BATCH'});
          const r=child.result as any;reference={...reference,revision:r.after.table.revision};
          broker.store.updateOperation(data.operationId,'running',result());
          probe=await host.request('readWordBatchCell',{reference,row:edit.row,column:edit.column});
        }
      }
      return broker.store.updateOperation(data.operationId,'applied',{...result(),verified:true,revision:reference.revision,code:'VERIFIED'});
    }catch(error){const conflict=error instanceof Error&&error.message.includes('REVISION_CONFLICT');return broker.store.updateOperation(data.operationId,children.some(c=>c.status==='unknown')?'unknown':!children.length&&conflict?'conflict':'failed',{...result(),verified:false,code:children.length?'BATCH_STOPPED':'PREFLIGHT_REFUSED',message:error instanceof Error?error.message:'Inspect the batch before another edit.'});}
  });
}
export async function restoreWordTableBatch(broker:DocumentBroker,id:string){
  const original=broker.store.getOperation(id),r=original?.result as any;
  if(!original||original.kind!=='word.table.batch'||!r?.restoreAvailable||id.startsWith('restore_'))throw new AppError('RECOVERY_UNAVAILABLE','Known verified batch steps are required.');
  const restoreId='restore_'+digest(id).slice(0,48),started=broker.store.begin(restoreId,original.documentId,'word.table.batch.restore',{originalId:id});
  if(!started.fresh)return broker.inFlight.get(restoreId)??started.operation;
  return inDocumentLane(broker,original.documentId,restoreId,async lane=>{
    const restored:Operation[]=[];
    try{
      const records=(r.children as {id:string}[]).map(c=>broker.store.getOperation(c.id));
      if(records.some(c=>!c))throw new AppError('RECOVERY_UNAVAILABLE','Batch child journal is missing.');
      const children=records.filter((c):c is Operation=>!!c&&c.status==='applied').reverse();
      if(!children.length||children.some(c=>c.documentId!==original.documentId||!(c.result as any)?.verified||!['word.replace','word.format'].includes(c.kind)))throw new AppError('RECOVERY_UNAVAILABLE','Batch journal is incomplete.');
      const last=children[0],cell=(last.result as any).after.table;
      await lane.host(original.documentId).request('readWordBatchCell',{reference:r.reference,row:cell.row,column:cell.column});
      for(const child of children){
        const op=child.kind==='word.replace'?await restoreWordReplacement(lane,child.id):await restoreWordFormat(lane,child.id);restored.push(op);
        broker.store.updateOperation(restoreId,'running',{children:restored.map(summary),atomic:false});
        if(op.status!=='applied')return broker.store.updateOperation(restoreId,op.status==='unknown'?'unknown':'conflict',{children:restored.map(summary),verified:false,atomic:false,code:'PARTIAL_RECOVERY'});
      }
      return broker.store.updateOperation(restoreId,'applied',{children:restored.map(summary),verified:true,atomic:false,code:'VERIFIED'});
    }catch(error){return broker.store.updateOperation(restoreId,restored.length?'unknown':'conflict',{children:restored.map(summary),verified:false,atomic:false,message:error instanceof Error?error.message:'Inspect recovery.'});}
  });
}
