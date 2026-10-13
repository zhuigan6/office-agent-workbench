import {z} from 'zod';
import {AppError} from '../contracts/index.ts';
import type {DocumentBroker} from './broker.ts';
import {digest} from './store.ts';
import {wordTableReferenceSchema} from './word-table-batch.ts';
import {executeWordTableMutation} from './word-table-layout.ts';
export const wordTableRowsSchema=z.object({operationId:z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),reference:wordTableReferenceSchema,append:z.array(z.array(z.string().max(2000).refine(v=>!/[\u0000-\u001f\u2028\u2029]/.test(v))).min(1).max(20)).min(1).max(10)}).strict().superRefine((v,c)=>{
  if(v.reference.rows+v.append.length>20||v.append.some(r=>r.length!==v.reference.columns)||v.append.flat().join('').length>20000)c.addIssue({code:'custom',message:'Append1..10 rows with exactly the existing columns, at most20 total rows and20000 new text characters.'});
});
export async function appendWordTableRows(broker:DocumentBroker,documentId:string,input:unknown){
  const data=wordTableRowsSchema.parse(input);return executeWordTableMutation(broker,documentId,data.operationId,'word.table.rows',{reference:data.reference,append:data.append});
}
export async function restoreWordTableRows(broker:DocumentBroker,id:string){
  const op=broker.store.getOperation(id),r=op?.result as any;
  if(!op||op.kind!=='word.table.rows'||op.status!=='applied'||!r?.verified||!r.before||!r.after||id.startsWith('restore_'))throw new AppError('RECOVERY_UNAVAILABLE','A verified append-row journal is required.');
  return executeWordTableMutation(broker,op.documentId,'restore_'+digest(id).slice(0,48),'word.table.rows',{reference:r.after.reference,restore:r.before});
}
