import {AppError,type Operation} from '../contracts/index.ts';
import {excelChartLayoutSchema,excelChartCreateSchema} from '../contracts/excel-chart.ts';
import type {DocumentBroker} from './broker.ts';
import {digest,revision} from './store.ts';
import type {CapturedSelection} from '../contracts/selection.ts';
import {planPptTextEdit} from '../contracts/ppt-replace.ts';
export async function layoutExcelChart(broker:DocumentBroker,documentId:string,input:unknown,selection?:CapturedSelection){const data=excelChartLayoutSchema.parse(input);const {operationId,...payload}=data;return execute(broker,documentId,operationId,{...payload,...(selection?{selection}:{})});}
export async function createExcelChart(broker:DocumentBroker,documentId:string,input:unknown,selection?:CapturedSelection){const data=excelChartCreateSchema.parse(input);const {operationId,...payload}=data;return execute(broker,documentId,operationId,{...payload,...(selection?{selection}:{})},'excel.chart.create');}
export async function restoreExcelChart(broker:DocumentBroker,id:string){
  const op=broker.store.getOperation(id),r=op?.result as any;
  if(!op||!['excel.chart.layout','excel.chart.create'].includes(op.kind)||op.status!=='applied'||!r?.verified||!r.before||!r.after||id.startsWith('restore_'))throw new AppError('RECOVERY_UNAVAILABLE','A verified Excel chart journal is required.');
  if(op.kind==='excel.chart.create'){
    if(!/^[a-f0-9]{64}$/.test(r.after.packageGuard?.hash??''))throw new AppError('RECOVERY_UNAVAILABLE','The new chart lacks a complete package guard.');
    return execute(broker,op.documentId,'restore_'+digest(id).slice(0,48),{reference:r.after.reference,removeCreated:true,expectedGuard:r.after.packageGuard.hash,source:r.before.source,sourceState:r.before.sourceState},'excel.chart.create');
  }
  if((op.payload as any).properties)return execute(broker,op.documentId,'restore_'+digest(id).slice(0,48),{reference:r.after.reference,restoreFormat:r.before});
  return execute(broker,op.documentId,'restore_'+digest(id).slice(0,48),{reference:r.after.reference,restore:r.before,fields:Object.keys((op.payload as any).geometry)});
}
async function execute(broker:DocumentBroker,documentId:string,id:string,payload:any,kind:'excel.chart.layout'|'excel.chart.create'='excel.chart.layout'):Promise<Operation>{
  const started=broker.store.begin(id,documentId,kind,payload);if(!started.fresh)return broker.inFlight.get(id)??started.operation;
  const pending=(broker.queues.get(documentId)??Promise.resolve()).catch(()=>{}).then(async()=>{
    let issued=false,before:any;
    try{const host=broker.host(documentId);if(host.binding.kind!=='excel'||!host.binding.capabilities.includes('write'))throw new AppError('HOST_KIND','Writable Excel is required.');
      broker.store.updateOperation(id,'running',null);before=await host.request(kind==='excel.chart.create'&&!payload.removeCreated?'readExcelChartCreate':payload.properties||payload.restoreFormat?'readExcelChartFormat':'readExcelChart',payload);
      if(kind==='excel.chart.create'&&!payload.removeCreated&&revision(before.sourceState)!==payload.source.revision)return broker.store.updateOperation(id,'conflict',{before,code:'REVISION_CONFLICT'});
      let titleProfileOrigins:number[]|undefined;
      if(payload.properties?.title&&before.format?.title){const text=before.format.title;titleProfileOrigins=planPptTextEdit({text,start:1,length:text.length,profiles:Array(text.length).fill(null)},payload.properties.title).expectedProfileOrigins;}
      broker.store.updateOperation(id,'running',{before});issued=true;
      const method=kind==='excel.chart.create'?(payload.removeCreated?'removeExcelCreatedChart':'writeExcelChartCreate'):'writeExcelChartLayout';
      const r=await host.request(method,{...payload,before,...(titleProfileOrigins?{titleProfileOrigins}:{})});return broker.store.updateOperation(id,r.code==='REVISION_CONFLICT'?'conflict':r.notIssued?'failed':r.verified?'applied':'unknown',r);
    }catch(error){return broker.store.updateOperation(id,issued?'unknown':error instanceof Error&&error.message.includes('REVISION_CONFLICT')?'conflict':'failed',{before,message:error instanceof Error?error.message:String(error)});}
  });
  broker.queues.set(documentId,pending);broker.inFlight.set(id,pending);try{return await pending;}finally{broker.inFlight.delete(id);if(broker.queues.get(documentId)===pending)broker.queues.delete(documentId);}
}
