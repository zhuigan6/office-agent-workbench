import {AppError,type Operation} from '../contracts/index.ts';
import {pptFormatSchema} from '../contracts/ppt-format.ts';
import {digest} from './store.ts';
import type {DocumentBroker} from './broker.ts';
export async function formatPptSelection(broker:DocumentBroker,documentId:string,input:unknown){
  const data=pptFormatSchema.parse(input);
  if(data.selection.documentId!==documentId)throw new AppError('SELECTION_SCOPE','Selection belongs to another document.',403);
  const rich=Boolean(data.paragraph)||data.font?.name!==undefined||data.font?.color!==undefined||(data.selection.kind==='powerpoint'&&data.selection.frameProfileVersion===1&&Boolean(data.selection.replacementRevision));
  return execute(broker,documentId,data.operationId,{selection:data.selection,...(data.font?{font:data.font}:{}),...(data.paragraph?{paragraph:data.paragraph}:{}),fields:Object.keys(data.font??{}),...(rich?{rich:true}:{}),expectedFingerprint:rich&&data.selection.kind==='powerpoint'?data.selection.replacementRevision:data.selection.contentHash});
}
export async function restorePptFormat(broker:DocumentBroker,id:string){
  const original=broker.store.getOperation(id),r=original?.result as any;
  if(!original||original.kind!=='ppt.format'||original.status!=='applied'||!r?.verified||!r.before?.state||!r.revision||id.startsWith('restore_'))throw new AppError('RECOVERY_UNAVAILABLE','A verified PowerPoint formatting operation is required.');
  const payload=original.payload as any,before=r.before.state,nominal=r.beforeNominal?.state??before;
  return execute(broker,original.documentId,'restore_'+digest(id).slice(0,48),{selection:r.continuationSelection??r.before.selection,fields:payload.fields,...(payload.rich?{rich:true,...(payload.fields.length?{restoreProfiles:nominal.profiles.slice(before.start-1,before.start-1+before.length)}:{}),...(payload.paragraph?{paragraph:payload.paragraph,restoreParagraphs:before.paragraphs}:{})}:{restore:before.fonts.slice(before.start-1,before.start-1+before.length)}),expectedFingerprint:payload.rich?r.replacementRevision:r.revision});
}
async function execute(broker:DocumentBroker,documentId:string,operationId:string,payload:any):Promise<Operation>{
  const {operation,fresh}=broker.store.begin(operationId,documentId,'ppt.format',payload);
  if(!fresh)return broker.inFlight.get(operationId)??operation;
  const execution=(broker.queues.get(documentId)??Promise.resolve()).catch(()=>{}).then(async()=>{
    let issued=false,before:any;
    try{
      const host=broker.host(documentId);
      if(host.binding.kind!=='powerpoint'||!host.binding.capabilities.includes('writeText'))throw new AppError('UNSUPPORTED','Bound presentation is not writable.');
      broker.store.updateOperation(operationId,'running',null);before=await host.request(payload.rich?'readPptReplacement':'readPptFormat',payload);
      if(before.contentHash!==payload.expectedFingerprint)return broker.store.updateOperation(operationId,'conflict',{code:'REVISION_CONFLICT'});
      broker.store.updateOperation(operationId,'running',{before});issued=true;
      const result=await host.request(payload.rich?'writePptRichFormat':'writePptFormat',payload);
      return broker.store.updateOperation(operationId,result.notIssued?'failed':result.code==='REVISION_CONFLICT'?'conflict':result.verified?'applied':'unknown',result);
    }catch(error){return broker.store.updateOperation(operationId,issued?'unknown':'failed',{before,message:error instanceof Error?error.message:String(error)});}
  });
  broker.queues.set(documentId,execution);broker.inFlight.set(operationId,execution);
  try{return await execution;}finally{broker.inFlight.delete(operationId);if(broker.queues.get(documentId)===execution)broker.queues.delete(documentId);}
}
