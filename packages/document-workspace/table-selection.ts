import {AppError,canonical,type Operation} from '../contracts/index.ts';
import {selectionSchema} from '../contracts/selection.ts';
import type {SelectionTickets} from './selections.ts';
import type {DocumentBroker} from './broker.ts';

// Resolve only the user's frozen whole-table anchor; never substitute a current
// selection or a model-provided table after text lengths/row counts change.
export async function mutateSelectedTable(tickets:SelectionTickets,broker:DocumentBroker,scope:{conversation:string;documentId:string},input:{selectionId:string;operationId:string;reference?:unknown},execute:(reference:unknown)=>Promise<Operation>){
  const before=tickets.forOperation(input.selectionId,scope.conversation,scope.documentId,input.operationId);
  if(before.kind!=='word'||!before.table)throw new AppError('TABLE_SELECTION_REQUIRED','Select one complete ordinary table, not a cell or a partial range.',409);
  if(input.reference!==undefined&&canonical(input.reference)!==canonical(before.table))throw new AppError('SELECTION_SCOPE','Do not substitute the captured table reference.',403);
  const operation=await execute(before.table),result=operation.result as any;
  let selectionReference:unknown={status:'not-advanced'};
  if(operation.status==='applied'&&result?.verified===true){
    const reference=result.after?.reference??result.reference;
    try{
      const candidate=selectionSchema.parse({...await broker.host(scope.documentId).request('readWordTableSelection',{reference}),documentId:scope.documentId});
      selectionReference=tickets.complete(input.selectionId,scope.conversation,scope.documentId,{...operation,result:{...result,continuationSelection:candidate}});
    }catch{
      selectionReference={status:'not-advanced',instruction:'The edit is recorded, but its table reference cannot continue. Inspect and capture a new explicit reference; do not replay.'};
    }
  }
  return {operation,selectionReference};
}
