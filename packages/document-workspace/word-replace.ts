import {AppError,type Operation} from '../contracts/index.ts';
import {wordReplaceSchema,planTextSplices} from '../contracts/word-replace.ts';
import {digest} from './store.ts';
import type {DocumentBroker} from './broker.ts';

export async function replaceWordSelection(broker:DocumentBroker,documentId:string,input:unknown){
  const data=wordReplaceSchema.parse(input);
  if(data.selection.documentId!==documentId)throw new AppError('SELECTION_SCOPE','Selection belongs to another document.',403);
  return execute(broker,documentId,data.operationId,{selection:data.selection,text:data.text,expectedFingerprint:data.selection.contentHash});
}
export async function restoreWordReplacement(broker:DocumentBroker,id:string){
  const original=broker.store.getOperation(id),result=original?.result as any;
  if(!original||original.kind!=='word.replace'||original.status!=='applied'||!result?.verified||!result.before?.paragraph?.xml||!result.after?.selection||!result.revision||id.startsWith('restore_'))throw new AppError('RECOVERY_UNAVAILABLE','A verified Word replacement and its original paragraph snapshot are required.');
  return execute(broker,original.documentId,'restore_'+digest(id).slice(0,48),{selection:result.after.selection,text:result.before.text,restoreParagraph:result.before.paragraph,expectedParagraphHash:result.after.paragraph.contentHash,expectedFingerprint:result.revision});
}
async function execute(broker:DocumentBroker,documentId:string,operationId:string,payload:any):Promise<Operation>{
  const {operation,fresh}=broker.store.begin(operationId,documentId,'word.replace',payload);
  if(!fresh)return broker.inFlight.get(operationId)??operation;
  const execution=(broker.queues.get(documentId)??Promise.resolve()).catch(()=>{}).then(async()=>{
    let issued=false,before:any;
    try{
      const host=broker.host(documentId);
      if(host.binding.kind!=='word'||!host.binding.capabilities.includes('writeText'))throw new AppError('UNSUPPORTED','Bound Word document is not writable.');
      broker.store.updateOperation(operationId,'running',null);
      before=await host.request('readWordReplacement',payload);
      if(before.contentHash!==payload.expectedFingerprint)return broker.store.updateOperation(operationId,'conflict',{code:'REVISION_CONFLICT'});
      broker.store.updateOperation(operationId,'running',{before});
      const splices=payload.restoreParagraph?undefined:planTextSplices(before.text,payload.text);
      issued=true;const result=await host.request('writeWordReplacement',{...payload,splices});
      return broker.store.updateOperation(operationId,result.notIssued?'failed':result.code==='REVISION_CONFLICT'?'conflict':result.verified?'applied':'unknown',result);
    }catch(error){return broker.store.updateOperation(operationId,issued?'unknown':'failed',{before,message:error instanceof Error?error.message:String(error)});}
  });
  broker.queues.set(documentId,execution);broker.inFlight.set(operationId,execution);
  try{return await execution;}finally{broker.inFlight.delete(operationId);if(broker.queues.get(documentId)===execution)broker.queues.delete(documentId);}
}
