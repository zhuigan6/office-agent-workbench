import {AppError,type Operation} from '../contracts/index.ts';
import {pptLayoutSchema} from '../contracts/ppt-layout.ts';
import {digest} from './store.ts';
import type {DocumentBroker} from './broker.ts';
export async function layoutPptSelection(broker:DocumentBroker,documentId:string,input:unknown){
  const data=pptLayoutSchema.parse(input);
  if(data.selection.documentId!==documentId)throw new AppError('SELECTION_SCOPE','Selection belongs to another document.',403);
  if(data.selection.kind!=='powerpoint')throw new AppError('HOST_KIND','PowerPoint is required.');
  return execute(broker,documentId,data.operationId,{selection:data.selection,geometry:data.geometry,expectedFingerprint:data.selection.layoutRevision,...(data.selection.contentHash!==data.selection.layoutRevision?{expectedTextFingerprint:data.selection.contentHash}:{})});
}
export async function restorePptLayout(broker:DocumentBroker,id:string){
  const original=broker.store.getOperation(id),r=original?.result as any;
  if(!original||original.kind!=='ppt.layout'||original.status!=='applied'||!r?.verified||!r.before?.state?.geometry||!r.revision||id.startsWith('restore_'))throw new AppError('RECOVERY_UNAVAILABLE','A verified original shape layout operation is required.');
  return execute(broker,original.documentId,'restore_'+digest(id).slice(0,48),{selection:r.before.selection,geometry:r.before.state.geometry,expectedFingerprint:r.revision,...(r.afterText?.contentHash?{expectedTextFingerprint:r.afterText.contentHash}:{})});
}
async function execute(broker:DocumentBroker,documentId:string,operationId:string,payload:any):Promise<Operation>{
  const {operation,fresh}=broker.store.begin(operationId,documentId,'ppt.layout',payload);
  if(!fresh)return broker.inFlight.get(operationId)??operation;
  const execution=(broker.queues.get(documentId)??Promise.resolve()).catch(()=>{}).then(async()=>{
    let issued=false,before:any;
    try{
      const host=broker.host(documentId);if(host.binding.kind!=='powerpoint'||!host.binding.capabilities.includes('writeText'))throw new AppError('UNSUPPORTED','Bound presentation is not writable.');
      broker.store.updateOperation(operationId,'running',null);before=await host.request('readPptLayout',payload);
      if(before.contentHash!==payload.expectedFingerprint)return broker.store.updateOperation(operationId,'conflict',{code:'REVISION_CONFLICT'});
      broker.store.updateOperation(operationId,'running',{before});issued=true;
      const result=await host.request('writePptLayout',payload);
      return broker.store.updateOperation(operationId,result.notIssued?'failed':result.code==='REVISION_CONFLICT'?'conflict':result.verified?'applied':'unknown',result);
    }catch(error){return broker.store.updateOperation(operationId,issued?'unknown':'failed',{before,message:error instanceof Error?error.message:String(error)});}
  });
  broker.queues.set(documentId,execution);broker.inFlight.set(operationId,execution);
  try{return await execution;}finally{broker.inFlight.delete(operationId);if(broker.queues.get(documentId)===execution)broker.queues.delete(documentId);}
}
