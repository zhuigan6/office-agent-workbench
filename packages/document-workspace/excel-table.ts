import {AppError,type Operation} from '../contracts/index.ts';
import {excelTableStyleSchema,excelTableRowsSchema,excelTableColumnsSchema} from '../contracts/excel-table.ts';
import type {DocumentBroker} from './broker.ts';
import {digest} from './store.ts';
import type {CapturedSelection} from '../contracts/selection.ts';
export async function styleExcelTable(broker:DocumentBroker,documentId:string,input:unknown,selection?:CapturedSelection){const data=excelTableStyleSchema.parse(input);return execute(broker,documentId,data.operationId,{reference:data.reference,properties:data.properties,...(selection?{selection}:{})});}
export async function appendExcelTable(broker:DocumentBroker,documentId:string,input:unknown,selection?:CapturedSelection){const data=excelTableRowsSchema.parse(input);return execute(broker,documentId,data.operationId,{reference:data.reference,append:data.append,formulas:data.formulas,...(selection?{selection}:{})},'excel.table.rows');}
export async function appendExcelColumns(broker:DocumentBroker,documentId:string,input:unknown,selection?:CapturedSelection){const data=excelTableColumnsSchema.parse(input);return execute(broker,documentId,data.operationId,{reference:data.reference,append:data.append,...(selection?{selection}:{})},'excel.table.columns');}
export async function restoreExcelTable(broker:DocumentBroker,id:string){
  const op=broker.store.getOperation(id),r=op?.result as any;
  if(!op||!['excel.table.style','excel.table.rows','excel.table.columns'].includes(op.kind)||op.status!=='applied'||!r?.verified||!r.before||!r.after||id.startsWith('restore_'))throw new AppError('RECOVERY_UNAVAILABLE','A verified Excel table journal is required.');
  if(op.kind==='excel.table.columns')return execute(broker,op.documentId,'restore_'+digest(id).slice(0,48),{reference:r.after.reference,restore:r.before,expectedSourceHash:r.after.source.hash,expectedFormulaHash:r.after.package.formulaHash,expectedTableHash:r.after.package.table.hash},'excel.table.columns');
  return execute(broker,op.documentId,'restore_'+digest(id).slice(0,48),{reference:r.after.reference,restore:r.before,...(op.kind==='excel.table.rows'?{expectedTailHash:r.after.tail.hash}:{fields:Object.keys((op.payload as any).properties)})},op.kind as 'excel.table.style'|'excel.table.rows');
}
async function execute(broker:DocumentBroker,documentId:string,id:string,payload:any,kind:'excel.table.style'|'excel.table.rows'|'excel.table.columns'='excel.table.style'):Promise<Operation>{
  const started=broker.store.begin(id,documentId,kind,payload);if(!started.fresh)return broker.inFlight.get(id)??started.operation;
  const pending=(broker.queues.get(documentId)??Promise.resolve()).catch(()=>{}).then(async()=>{
    let issued=false,before:any;
    try{const host=broker.host(documentId);if(host.binding.kind!=='excel'||!host.binding.capabilities.includes('write'))throw new AppError('HOST_KIND','Writable Excel is required.');
      broker.store.updateOperation(id,'running',null);before=await host.request(kind==='excel.table.columns'&&!payload.restore?'readExcelTableColumns':kind==='excel.table.rows'&&!payload.restore?'readExcelTableAppend':'readExcelTable',payload);broker.store.updateOperation(id,'running',{before});issued=true;
      const r=await host.request(kind==='excel.table.columns'?'writeExcelTableColumns':kind==='excel.table.rows'?'writeExcelTableRows':'writeExcelTableStyle',kind==='excel.table.columns'?{...payload,before}:payload);return broker.store.updateOperation(id,r.code==='REVISION_CONFLICT'?'conflict':r.notIssued?'failed':r.verified?'applied':'unknown',r.before?r:{before,...r});
    }catch(error){return broker.store.updateOperation(id,issued?'unknown':error instanceof Error&&error.message.includes('REVISION_CONFLICT')?'conflict':'failed',{before,message:error instanceof Error?error.message:String(error)});}
  });
  broker.queues.set(documentId,pending);broker.inFlight.set(id,pending);try{return await pending;}finally{broker.inFlight.delete(id);if(broker.queues.get(documentId)===pending)broker.queues.delete(documentId);}
}
