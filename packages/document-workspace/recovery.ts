import {AppError,type Operation} from '../contracts/index.ts';
import {digest} from './store.ts';
import type {DocumentBroker} from './broker.ts';
import {restoreWordFormat} from './word-format.ts';
import {restoreWordReplacement} from './word-replace.ts';
import {restorePptFormat} from './ppt-format.ts';
import {restorePptLayout} from './ppt-layout.ts';

export function recoveryRequest(operation:Operation){
  const result=operation.result as any,payload=operation.payload as any;
  if(operation.status!=='applied'||!result?.verified||!result.before||!result.revision||operation.id.startsWith('restore_'))
    throw new AppError('RECOVERY_UNAVAILABLE','Only a verified original edit with a saved before-state can be restored.');
  const operationId='restore_'+digest(operation.id).slice(0,48);
  if(operation.kind==='excel.write')return {kind:'excel' as const,data:{documentId:operation.documentId,operationId,
    sheet:payload.sheet,range:payload.range,expectedRevision:result.revision,
    formulas:result.before.formulas,numberFormat:result.before.numberFormat}};
  if(operation.kind==='text.write')return {kind:'text' as const,data:{operationId,target:payload.target,
    expectedRevision:result.revision,text:result.before.text}};
  throw new AppError('RECOVERY_UNAVAILABLE','File copies are preserved separately; this action restores only live edits.');
}
export async function restoreOperation(broker:DocumentBroker,id:string){
  const operation=broker.store.getOperation(id);
  if(!operation)throw new AppError('NOT_FOUND','Operation not found.',404);
  if(operation.kind==='ppt.layout'){
    const result=await restorePptLayout(broker,id);broker.store.event('operation.restore',{originalId:id,restoreId:result.id,status:result.status});return result;
  }
  if(operation.kind==='ppt.format'){
    const result=await restorePptFormat(broker,id);broker.store.event('operation.restore',{originalId:id,restoreId:result.id,status:result.status});return result;
  }
  if(operation.kind==='word.replace'){
    const result=await restoreWordReplacement(broker,id);
    broker.store.event('operation.restore',{originalId:id,restoreId:result.id,status:result.status});return result;
  }
  if(operation.kind==='word.format'){
    const result=await restoreWordFormat(broker,id);
    broker.store.event('operation.restore',{originalId:id,restoreId:result.id,status:result.status});return result;
  }
  const request=recoveryRequest(operation);
  const result=request.kind==='excel'?await broker.write(request.data):await broker.writeText(operation.documentId,request.data);
  broker.store.event('operation.restore',{originalId:id,restoreId:result.id,status:result.status});
  return result;
}
