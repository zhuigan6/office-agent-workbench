import {z} from 'zod';
import {AppError,type Operation} from '../contracts/index.ts';
import type {DocumentBroker} from './broker.ts';
import {digest} from './store.ts';
import {wordTableReferenceSchema} from './word-table-batch.ts';

const padding=z.number().finite().min(0).max(72).refine(n=>Number.isInteger(n*20),'Use twentieth-point increments.');
const columnWidth=z.number().finite().min(18).max(1000).refine(v=>Number.isInteger(v*20),'Use twentieth-point increments.');
const border=z.union([z.object({style:z.literal('none')}).strict(),z.object({style:z.enum(['single','dotted','dashed','double']),width:z.number().refine(v=>[0.25,0.5,0.75,1,1.5,2.25,3,4.5,6].includes(v)),color:z.union([z.literal('auto'),z.string().regex(/^#[0-9A-Fa-f]{6}$/)])}).strict()]);
export const wordTableBorders=z.object({top:border.optional(),left:border.optional(),bottom:border.optional(),right:border.optional(),insideHorizontal:border.optional(),insideVertical:border.optional()}).strict().refine(v=>Object.keys(v).length>0,'At least one border edge is required.');
export const wordTableLayoutProperties=z.object({alignment:z.enum(['left','center','right']).optional(),topPadding:padding.optional(),bottomPadding:padding.optional(),leftPadding:padding.optional(),rightPadding:padding.optional(),allowBreakAcrossPages:z.boolean().optional(),columnWidths:z.array(columnWidth).min(1).max(20).optional(),borders:wordTableBorders.optional()}).strict().refine(v=>Object.keys(v).length>0,'At least one table property is required.');
export const wordTableLayoutSchema=z.object({operationId:z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),reference:wordTableReferenceSchema,properties:wordTableLayoutProperties}).strict().superRefine((v,c)=>{if(v.properties.columnWidths&&v.properties.columnWidths.length!==v.reference.columns)c.addIssue({code:'custom',message:'Provide exactly one point width for every table column.'});});
export async function layoutWordTable(broker:DocumentBroker,documentId:string,input:unknown){
  const data=wordTableLayoutSchema.parse(input);
  return executeWordTableMutation(broker,documentId,data.operationId,'word.table.layout',{reference:data.reference,properties:data.properties});
}
export async function restoreWordTableLayout(broker:DocumentBroker,id:string){
  const op=broker.store.getOperation(id),r=op?.result as any;
  if(!op||op.kind!=='word.table.layout'||op.status!=='applied'||!r?.verified||!r.before||!r.after||id.startsWith('restore_'))throw new AppError('RECOVERY_UNAVAILABLE','A verified table layout journal is required.');
  const properties=(op.payload as any).properties;
  return executeWordTableMutation(broker,op.documentId,'restore_'+digest(id).slice(0,48),'word.table.layout',{reference:r.after.reference,restore:r.before,fields:Object.keys(properties),...(properties.borders?{borderFields:Object.keys(properties.borders)}:{})});
}
export async function executeWordTableMutation(broker:DocumentBroker,documentId:string,operationId:string,kind:'word.table.layout'|'word.table.rows',payload:any):Promise<Operation>{
  const started=broker.store.begin(operationId,documentId,kind,payload);
  if(!started.fresh)return broker.inFlight.get(operationId)??started.operation;
  const pending=(broker.queues.get(documentId)??Promise.resolve()).catch(()=>{}).then(async()=>{
    let issued=false,before:any;
    try{
      const host=broker.host(documentId);
      if(host.binding.kind!=='word'||!host.binding.capabilities.includes('writeText'))throw new AppError('HOST_KIND','Writable Word is required.');
      broker.store.updateOperation(operationId,'running',null);
      before=await host.request('readWordTableLayout',payload);
      broker.store.updateOperation(operationId,'running',{before});issued=true;
      const r=await host.request(kind==='word.table.rows'?'writeWordTableRows':'writeWordTableLayout',payload);
      return broker.store.updateOperation(operationId,r.notIssued?'failed':r.code==='REVISION_CONFLICT'?'conflict':r.verified?'applied':'unknown',r);
    }catch(error){return broker.store.updateOperation(operationId,issued?'unknown':error instanceof Error&&error.message.includes('REVISION_CONFLICT')?'conflict':'failed',{before,code:kind==='word.table.rows'?'TABLE_ROWS_ERROR':'TABLE_LAYOUT_ERROR',message:error instanceof Error?error.message:String(error)});}
  });
  broker.queues.set(documentId,pending);broker.inFlight.set(operationId,pending);
  try{return await pending;}finally{broker.inFlight.delete(operationId);if(broker.queues.get(documentId)===pending)broker.queues.delete(documentId);}
}
