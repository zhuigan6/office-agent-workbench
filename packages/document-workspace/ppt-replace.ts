import {AppError,type Operation} from '../contracts/index.ts';
import {pptReplaceSchema,planPptTextEdit} from '../contracts/ppt-replace.ts';
import {digest} from './store.ts';
import type {DocumentBroker} from './broker.ts';
export async function replacePptSelection(broker:DocumentBroker,documentId:string,input:unknown){
  const data=pptReplaceSchema.parse(input);
  if(data.selection.documentId!==documentId)throw new AppError('SELECTION_SCOPE','Selection belongs to another presentation.',403);
  return execute(broker,documentId,data.operationId,{selection:data.selection,text:data.text,expectedFingerprint:(data.selection as any).replacementRevision});
}
export async function restorePptReplacement(broker:DocumentBroker,id:string){
  const original=broker.store.getOperation(id),r=original?.result as any;
  if(!original||original.kind!=='ppt.replace'||original.status!=='applied'||!r?.verified||!r.before?.state||!r.continuationSelection||id.startsWith('restore_'))throw new AppError('RECOVERY_UNAVAILABLE','A verified PowerPoint replacement snapshot is required.');
  const s=r.before.state,text=s.text.slice(s.start-1,s.start-1+s.length);
  return execute(broker,original.documentId,'restore_'+digest(id).slice(0,48),{selection:r.continuationSelection,text,expectedFingerprint:r.revision,restoreState:s,...(r.beforeNominal?{restoreNominalProfiles:r.beforeNominal.state.profiles}:{})});
}
async function execute(broker:DocumentBroker,documentId:string,operationId:string,payload:any):Promise<Operation>{
  const {operation,fresh}=broker.store.begin(operationId,documentId,'ppt.replace',payload);
  if(!fresh)return broker.inFlight.get(operationId)??operation;
  const execution=(broker.queues.get(documentId)??Promise.resolve()).catch(()=>{}).then(async()=>{
    let issued=false,before:any;
    try{
      const host=broker.host(documentId);if(host.binding.kind!=='powerpoint'||!host.binding.capabilities.includes('writeText'))throw new AppError('HOST_KIND','Writable PowerPoint is required.');
      broker.store.updateOperation(operationId,'running',null);before=await host.request('readPptReplacement',payload);
      if(before.contentHash!==payload.expectedFingerprint)return broker.store.updateOperation(operationId,'conflict',{code:'REVISION_CONFLICT'});
      const plan=planPptTextEdit(before.state,payload.text);
      if(payload.restoreState){plan.expectedText=payload.restoreState.text;plan.expectedProfiles=payload.restoreState.profiles;}
      broker.store.updateOperation(operationId,'running',{before});issued=true;
      const result=await host.request('writePptReplacement',{...payload,...plan});
      return broker.store.updateOperation(operationId,result.notIssued?'failed':result.code==='REVISION_CONFLICT'?'conflict':result.verified?'applied':'unknown',result);
    }catch(error){return broker.store.updateOperation(operationId,issued?'unknown':'failed',{before,message:error instanceof Error?error.message:'Replacement requires inspection.'});}
  });
  broker.queues.set(documentId,execution);broker.inFlight.set(operationId,execution);
  try{return await execution;}finally{broker.inFlight.delete(operationId);if(broker.queues.get(documentId)===execution)broker.queues.delete(documentId);}
}
