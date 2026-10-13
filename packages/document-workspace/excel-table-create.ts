import {AppError,type Operation} from '../contracts/index.ts';
import {excelTableCreateSchema} from '../contracts/excel-table.ts';
import type {CapturedSelection} from '../contracts/selection.ts';
import type {DocumentBroker} from './broker.ts';
import {digest,revision} from './store.ts';
export async function createExcelTable(broker:DocumentBroker,documentId:string,input:unknown,selection?:CapturedSelection){const {operationId,...data}=excelTableCreateSchema.parse(input);return execute(broker,documentId,operationId,{...data,...(selection?{selection}:{})});}
export async function restoreExcelTableCreate(broker:DocumentBroker,id:string){const op=broker.store.getOperation(id),r=op?.result as any;
  if(!op||op.kind!=='excel.table.create'||op.status!=='applied'||!r?.verified||!r.before||!r.after?.package?.table?.hash||id.startsWith('restore_'))throw new AppError('RECOVERY_UNAVAILABLE','A verified new table and package/source snapshots are required.');
  return execute(broker,op.documentId,'restore_'+digest(id).slice(0,48),{reference:r.after.reference,removeCreated:true,restore:r.before,expectedSourceHash:r.after.sourceSnapshot.hash,expectedFormulaHash:r.after.package.formulaHash,expectedTableHash:r.after.package.table.hash});
}
async function execute(broker:DocumentBroker,documentId:string,id:string,payload:any):Promise<Operation>{const started=broker.store.begin(id,documentId,'excel.table.create',payload);if(!started.fresh)return broker.inFlight.get(id)??started.operation;
  const pending=(broker.queues.get(documentId)??Promise.resolve()).catch(()=>{}).then(async()=>{let issued=false,before:any;
    try{const host=broker.host(documentId);if(host.binding.kind!=='excel'||!host.binding.capabilities.includes('write'))throw new AppError('HOST_KIND','Writable Excel is required.');broker.store.updateOperation(id,'running',null);
      before=await host.request(payload.removeCreated?'readExcelTable':'readExcelTableCreate',payload);
      if(!payload.removeCreated&&revision(before.sourceSnapshot.state)!==payload.source.revision)return broker.store.updateOperation(id,'conflict',{before,code:'REVISION_CONFLICT'});
      broker.store.updateOperation(id,'running',{before});issued=true;const r=await host.request(payload.removeCreated?'removeExcelCreatedTable':'writeExcelTableCreate',{...payload,before});
      return broker.store.updateOperation(id,r.code==='REVISION_CONFLICT'?'conflict':r.notIssued?'failed':r.verified?'applied':'unknown',r);
    }catch(error){return broker.store.updateOperation(id,issued?'unknown':error instanceof Error&&error.message.includes('REVISION_CONFLICT')?'conflict':'failed',{before,message:error instanceof Error?error.message:String(error)});}
  });broker.queues.set(documentId,pending);broker.inFlight.set(id,pending);try{return await pending;}finally{broker.inFlight.delete(id);if(broker.queues.get(documentId)===pending)broker.queues.delete(documentId);}
}
