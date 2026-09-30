import {AppError,type Operation} from '../contracts/index.ts';
import {wordFormatSchema} from '../contracts/word-format.ts';
import {digest} from './store.ts';
import type {DocumentBroker} from './broker.ts';

export async function formatWordSelection(broker:DocumentBroker,documentId:string,input:unknown){
  const data=wordFormatSchema.parse(input);
  if(data.selection.documentId!==documentId)throw new AppError('SELECTION_SCOPE','Selection belongs to another document.',403);
  return execute(broker,documentId,data.operationId,{selection:data.selection,font:data.font,fields:Object.keys(data.font??{}),paragraph:data.paragraph,paragraphFields:Object.keys(data.paragraph??{}),expectedFingerprint:data.selection.contentHash});
}
export async function restoreWordFormat(broker:DocumentBroker,id:string){
  const original=broker.store.getOperation(id),result=original?.result as any;
  if(!original||original.kind!=='word.format'||original.status!=='applied'||!result?.verified||!result.before||!result.revision||id.startsWith('restore_'))throw new AppError('RECOVERY_UNAVAILABLE','A verified original Word format edit is required.');
  return execute(broker,original.documentId,'restore_'+digest(id).slice(0,48),{selection:result.before.selection,fields:result.before.fields,restore:result.before.formats,paragraphFields:result.before.paragraphFields??[],restoreParagraphFormats:result.before.paragraphs,expectedParagraphs:result.after?.paragraphs,expectedFingerprint:result.revision});
}
async function execute(broker:DocumentBroker,documentId:string,operationId:string,payload:any):Promise<Operation>{
  const {operation,fresh}=broker.store.begin(operationId,documentId,'word.format',payload);
  if(!fresh)return broker.inFlight.get(operationId)??operation;
  const execution=(broker.queues.get(documentId)??Promise.resolve()).catch(()=>{}).then(async()=>{
    let issued=false,before:any;
    try{
      const host=broker.host(documentId);
      if(host.binding.kind!=='word'||!host.binding.capabilities.includes('writeText'))throw new AppError('UNSUPPORTED','Bound Word document is not writable.');
      broker.store.updateOperation(operationId,'running',null);
      before=await host.request('readWordFormat',payload);
      if(before.contentHash!==payload.expectedFingerprint)return broker.store.updateOperation(operationId,'conflict',{code:'REVISION_CONFLICT'});
      broker.store.updateOperation(operationId,'running',{before});
      issued=true;
      const result=await host.request('writeWordFormat',payload);
      return broker.store.updateOperation(operationId,result.notIssued?'failed':result.code==='REVISION_CONFLICT'?'conflict':result.verified?'applied':'unknown',result);
    }catch(error){return broker.store.updateOperation(operationId,issued?'unknown':'failed',{before,code:error instanceof AppError?error.code:'WORD_FORMAT_ERROR',message:error instanceof Error?error.message:String(error)});}
  });
  broker.queues.set(documentId,execution);broker.inFlight.set(operationId,execution);
  try{return await execution;}finally{broker.inFlight.delete(operationId);if(broker.queues.get(documentId)===execution)broker.queues.delete(documentId);}
}
