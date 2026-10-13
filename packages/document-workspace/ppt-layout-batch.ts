import {z} from 'zod';
import {AppError,type Operation} from '../contracts/index.ts';
import {selectionSchema} from '../contracts/selection.ts';
import {pptLayoutEditSchema} from '../contracts/ppt-layout.ts';
import {digest} from './store.ts';
import {layoutPptSelection,restorePptLayout} from './ppt-layout.ts';
import type {DocumentBroker} from './broker.ts';

export const pptLayoutBatchSchema=z.object({operationId:z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),selection:selectionSchema,
  edits:z.array(pptLayoutEditSchema).min(1).max(20)}).strict().superRefine((value,context)=>{
  if(value.selection.kind!=='powerpoint'||!value.selection.shapeLayouts||new Set(value.edits.map(edit=>edit.shapeId)).size!==value.edits.length||value.edits.some(edit=>value.selection.kind!=='powerpoint'||!value.selection.shapeIds.includes(edit.shapeId)))
    context.addIssue({code:'custom',message:'Supply unique edits within one captured multi-shape reference.'});
  if(value.selection.kind==='powerpoint'&&value.edits.some(edit=>edit.appearance&&value.selection.kind==='powerpoint'&&value.selection.shapeLayouts?.find(item=>item.shapeId===edit.shapeId)?.appearanceProfileVersion!==1))context.addIssue({code:'custom',message:'Every appearance edit requires its own versioned whole-object capture; old geometry references cannot expand.'});
  if(value.selection.kind==='powerpoint'&&value.edits.some(edit=>{const state=value.selection.kind==='powerpoint'?value.selection.shapeLayouts?.find(item=>item.shapeId===edit.shapeId):undefined;return edit.textFrame&&(state?.frameProfileVersion!==1||!state.replacementRevision);}))context.addIssue({code:'custom',message:'Every frame edit requires its own complete rich frame snapshot; geometry-only references cannot expand.'});
});

/** Compose existing guarded shape writes. Each step is journaled; this is not an atomic Office transaction. */
export async function layoutPptBatch(broker:DocumentBroker,documentId:string,input:unknown){
  const data=pptLayoutBatchSchema.parse(input);
  if(data.selection.documentId!==documentId)throw new AppError('SELECTION_SCOPE','Selection belongs to another document.',403);
  const {operation,fresh}=broker.store.begin(data.operationId,documentId,'ppt.layout.batch',data);
  if(!fresh)return broker.inFlight.get(data.operationId)??operation;
  const promise=(async()=>{
    const children:Operation[]=[],snapshots:any[]=[];
    try{
      const host=broker.host(documentId),selection=data.selection;
      if(selection.kind!=='powerpoint'||!selection.shapeLayouts||host.binding.kind!=='powerpoint'||!host.binding.capabilities.includes('writeText'))throw new AppError('HOST_KIND','Writable PowerPoint selection is required.');
      broker.store.updateOperation(data.operationId,'running',{children:[]});
      await (broker.queues.get(documentId)??Promise.resolve()).catch(()=>{});
      const singles=data.edits.map(edit=>{
        const state=selection.shapeLayouts!.find(item=>item.shapeId===edit.shapeId)!;
        return {edit,selection:{...selection,shapeIds:[edit.shapeId],shapeLayouts:undefined,layoutRevision:state.layoutRevision,contentHash:state.contentHash,frameProfileVersion:state.frameProfileVersion,appearanceProfileVersion:state.appearanceProfileVersion,paragraphProfileVersion:state.paragraphProfileVersion,replacementRevision:state.replacementRevision}};
      });
      // Refuse a known stale batch before its first side effect; individual writes recheck again.
      for(const single of singles){
        const before=await host.request('readPptLayout',{selection:single.selection});
        if(before.contentHash!==single.selection.layoutRevision)return broker.store.updateOperation(data.operationId,'conflict',{code:'REVISION_CONFLICT',children:[]});
        if(single.selection.contentHash!==single.selection.layoutRevision){const text=await host.request('readPptFormat',{selection:single.selection});if(text.contentHash!==single.selection.contentHash)return broker.store.updateOperation(data.operationId,'conflict',{code:'REVISION_CONFLICT',children:[]});}
        const fittedResize=single.selection.frameProfileVersion===1&&single.selection.replacementRevision&&(single.edit.geometry?.width!==undefined||single.edit.geometry?.height!==undefined)&&[1,2].includes(before.state?.textFrame?.AutoSize);
        if(single.edit.textFrame||fittedResize){const rich=await host.request('readPptReplacement',{selection:single.selection});if(rich.contentHash!==single.selection.replacementRevision)return broker.store.updateOperation(data.operationId,'conflict',{code:'REVISION_CONFLICT',children:[]});}
        snapshots.push(before);
      }
      for(let index=0;index<singles.length;index++){
        const single=singles[index],child=await layoutPptSelection(broker,documentId,{operationId:'layout_step_'+digest([data.operationId,index]).slice(0,48),selection:single.selection,...(single.edit.geometry?{geometry:single.edit.geometry}:{}),...(single.edit.appearance?{appearance:single.edit.appearance}:{}),...(single.edit.textFrame?{textFrame:single.edit.textFrame}:{})});
        children.push(child);
        const result={before:snapshots,children,restoreAvailable:children.every(item=>item.status!=='unknown')&&children.some(item=>item.status==='applied'&&(item.result as any)?.verified),atomic:false};
        broker.store.updateOperation(data.operationId,'running',result);
        if(child.status!=='applied')return broker.store.updateOperation(data.operationId,child.status==='unknown'?'unknown':'failed',{...result,code:'PARTIAL_BATCH',verified:false});
      }
      const shapeLayouts=selection.shapeLayouts.map(item=>{
        const child=children.find(op=>(op.payload as any).selection.shapeIds[0]===item.shapeId),result=child?.result as any;
        return result?{...item,layoutRevision:result.revision,contentHash:result.afterText?.contentHash??result.revision,...(item.replacementRevision?{replacementRevision:result.continuationSelection?.replacementRevision??result.afterRich?.contentHash}:{})}:item;
      });
      const revision=digest(shapeLayouts),next={...selection,shapeLayouts,contentHash:revision};
      return broker.store.updateOperation(data.operationId,'applied',{before:snapshots,children,verified:true,restoreAvailable:true,atomic:false,code:'VERIFIED',revision,continuationSelection:next});
    }catch(error){return broker.store.updateOperation(data.operationId,children.some(child=>child.status==='unknown')?'unknown':'failed',{before:snapshots,children,verified:false,restoreAvailable:children.every(child=>child.status!=='unknown')&&children.some(child=>child.status==='applied'&&(child.result as any)?.verified),code:'BATCH_STOPPED',message:error instanceof Error?error.message:'Layout batch failed.',atomic:false});}
  })();
  broker.inFlight.set(data.operationId,promise);try{return await promise;}finally{broker.inFlight.delete(data.operationId);}
}

export async function restorePptBatch(broker:DocumentBroker,id:string){
  const original=broker.store.getOperation(id),r=original?.result as any;
  if(!original||original.kind!=='ppt.layout.batch'||!r?.restoreAvailable||id.startsWith('restore_'))throw new AppError('RECOVERY_UNAVAILABLE','A batch with verified applied steps is required.');
  const payload={originalId:id},restoreId='restore_'+digest(id).slice(0,48);
  const {operation,fresh}=broker.store.begin(restoreId,original.documentId,'ppt.layout.batch.restore',payload);
  if(!fresh)return broker.inFlight.get(restoreId)??operation;
  const promise=(async()=>{
    const restored:Operation[]=[];
    try{
      const children=(r.children as Operation[]).filter(child=>child.status==='applied'&&(child.result as any)?.verified).reverse(),host=broker.host(original.documentId);
      for(const child of children){
        const result=child.result as any,selection=(child.payload as any).selection;
        const now=await host.request('readPptLayout',{selection});
        if(now.contentHash!==result.revision)return broker.store.updateOperation(restoreId,'conflict',{code:'REVISION_CONFLICT',children:[]});
        if(result.afterText?.contentHash){const text=await host.request('readPptFormat',{selection});if(text.contentHash!==result.afterText.contentHash)return broker.store.updateOperation(restoreId,'conflict',{code:'REVISION_CONFLICT',children:[]});}
      }
      broker.store.updateOperation(restoreId,'running',{children:[]});
      for(const child of children){
        const result=await restorePptLayout(broker,child.id);restored.push(result);
        broker.store.updateOperation(restoreId,'running',{children:restored});
        if(result.status!=='applied')return broker.store.updateOperation(restoreId,result.status==='unknown'?'unknown':'conflict',{code:'PARTIAL_RECOVERY',children:restored,verified:false});
      }
      return broker.store.updateOperation(restoreId,'applied',{children:restored,verified:true,code:'VERIFIED',atomic:false});
    }catch(error){return broker.store.updateOperation(restoreId,'unknown',{children:restored,verified:false,message:error instanceof Error?error.message:'Batch recovery requires inspection.'});}
  })();
  broker.inFlight.set(restoreId,promise);try{return await promise;}finally{broker.inFlight.delete(restoreId);}
}
