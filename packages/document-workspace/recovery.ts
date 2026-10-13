import {AppError,type Operation} from '../contracts/index.ts';
import {digest} from './store.ts';
import type {DocumentBroker} from './broker.ts';
import {restoreWordFormat} from './word-format.ts';
import {restoreWordReplacement} from './word-replace.ts';
import {restorePptFormat} from './ppt-format.ts';
import {restorePptLayout} from './ppt-layout.ts';
import {restorePptBatch} from './ppt-layout-batch.ts';
import {restorePptReplacement} from './ppt-replace.ts';
import {restoreWordTableBatch} from './word-table-batch.ts';
import {restoreWordTableLayout} from './word-table-layout.ts';
import {restoreWordParagraphBatch} from './word-paragraph-batch.ts';
import {restoreWordTableRows} from './word-table-rows.ts';
import {restoreExcelTable} from './excel-table.ts';
import {restoreExcelChart} from './excel-chart.ts';
import {restoreExcelRangeFormat} from './excel-range-format.ts';
import {restoreExcelTableCreate} from './excel-table-create.ts';

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
  if(broker.store.getOperation(id)?.kind==='excel.table.create'){const r=await restoreExcelTableCreate(broker,id);broker.store.event('operation.restore',{originalId:id,restoreId:r.id,status:r.status});return r;}
  if(broker.store.getOperation(id)?.kind==='excel.range.format'){const r=await restoreExcelRangeFormat(broker,id);broker.store.event('operation.restore',{originalId:id,restoreId:r.id,status:r.status});return r;}
  if(['excel.chart.layout','excel.chart.create'].includes(broker.store.getOperation(id)?.kind??'')){const r=await restoreExcelChart(broker,id);broker.store.event('operation.restore',{originalId:id,restoreId:r.id,status:r.status});return r;}
  if(['excel.table.style','excel.table.rows','excel.table.columns'].includes(broker.store.getOperation(id)?.kind??'')){const r=await restoreExcelTable(broker,id);broker.store.event('operation.restore',{originalId:id,restoreId:r.id,status:r.status});return r;}
  const operation=broker.store.getOperation(id);
  if(!operation)throw new AppError('NOT_FOUND','Operation not found.',404);
  if(operation.kind==='word.table.rows'){const result=await restoreWordTableRows(broker,id);broker.store.event('operation.restore',{originalId:id,restoreId:result.id,status:result.status});return result;}
  if(operation.kind==='word.paragraph.batch'){const result=await restoreWordParagraphBatch(broker,id);broker.store.event('operation.restore',{originalId:id,restoreId:result.id,status:result.status});return result;}
  if(operation.kind==='word.table.layout'){const result=await restoreWordTableLayout(broker,id);broker.store.event('operation.restore',{originalId:id,restoreId:result.id,status:result.status});return result;}
  if(operation.kind==='word.table.batch'){const result=await restoreWordTableBatch(broker,id);broker.store.event('operation.restore',{originalId:id,restoreId:result.id,status:result.status});return result;}
  if(operation.kind==='ppt.replace'){
    const result=await restorePptReplacement(broker,id);broker.store.event('operation.restore',{originalId:id,restoreId:result.id,status:result.status});return result;
  }
  if(operation.kind==='ppt.layout.batch'){
    const result=await restorePptBatch(broker,id);broker.store.event('operation.restore',{originalId:id,restoreId:result.id,status:result.status});return result;
  }
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
