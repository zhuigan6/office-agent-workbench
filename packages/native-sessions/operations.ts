import {AppError,type Operation} from '../contracts/index.ts';
import {digest} from '../document-workspace/store.ts';
import type {Store} from '../document-workspace/store.ts';
import {writeToolResult} from '../contracts/tool-results.ts';

function recoveryView(operation:Operation,lookup:(id:string)=>Operation|undefined){
  const recovery=lookup('restore_'+digest(operation.id).slice(0,48));
  return {...operation,recovery:recovery?.documentId===operation.documentId?{id:recovery.id,status:recovery.status,retainedUnusedStyleDeclarations:(recovery.result as any)?.retainedUnusedStyleDeclarations??[],layoutDeclarationsNormalized:(recovery.result as any)?.layoutDeclarationsNormalized===true,retainedEmptyFontAliases:(recovery.result as any)?.retainedEmptyFontAliases??[],retainedBlankUsedRange:(recovery.result as any)?.retainedBlankUsedRange===true}:null};
}

export function nativeOperationsForStore(store:Store,linkId:string,documentId:string){
  const prefix=linkId.slice(0,32)+'_';
  return store.operationsForPrefix(prefix,documentId).filter(op=>op.documentId===documentId&&op.id.startsWith(prefix)).map(op=>recoveryView(op,id=>store.getOperation(id)));
}
export function nativeOperationSummary(operation:ReturnType<typeof recoveryView>){
  const result=operation.result as any;
  return {id:operation.id,documentId:operation.documentId,kind:operation.kind,status:operation.status,updatedAt:operation.updatedAt,recovery:operation.recovery,
    view:{canRestore:Boolean(((operation.status==='applied'&&result?.verified&&result?.before)||result?.restoreAvailable)&&operation.recovery?.status!=='applied'),receipt:writeToolResult(operation)}};
}
export function nativeOperationPage(operations:ReturnType<typeof recoveryView>[],before?:string){
  const index=before?operations.findIndex(op=>op.id===before):-1;
  if(before&&index<0)throw new AppError('NATIVE_OPERATION_SCOPE','Operation cursor does not belong to this document session.',403);
  const start=index+1,items=operations.slice(start,start+20),hasMore=operations.length>start+items.length;
  return {items:items.map(nativeOperationSummary),hasMore,nextCursor:hasMore?items.at(-1)?.id??null:null,total:operations.length};
}
export function assertNativeOperationForStore(store:Store,linkId:string,documentId:string,id:string){
  const operation=store.getOperation(id);
  if(!operation||operation.documentId!==documentId||!id.startsWith(linkId.slice(0,32)+'_'))throw new AppError('NATIVE_OPERATION_SCOPE','Operation does not belong to this document session.',403);
  return recoveryView(operation,recoveryId=>store.getOperation(recoveryId));
}

export function nativeOperations(operations:Operation[],linkId:string,documentId:string){
  const prefix=linkId.slice(0,32)+'_';
  return operations.filter(op=>op.documentId===documentId&&op.id.startsWith(prefix)).map(op=>{
    const recoveryId='restore_'+digest(op.id).slice(0,48);
    const recovery=operations.find(item=>item.id===recoveryId&&item.documentId===documentId);
    return {...op,recovery:recovery?{id:recovery.id,status:recovery.status,retainedUnusedStyleDeclarations:(recovery.result as any)?.retainedUnusedStyleDeclarations??[],layoutDeclarationsNormalized:(recovery.result as any)?.layoutDeclarationsNormalized===true,retainedEmptyFontAliases:(recovery.result as any)?.retainedEmptyFontAliases??[],retainedBlankUsedRange:(recovery.result as any)?.retainedBlankUsedRange===true}:null};
  });
}
export function assertNativeOperation(operations:Operation[],linkId:string,documentId:string,id:string){
  const operation=nativeOperations(operations,linkId,documentId).find(op=>op.id===id);
  if(!operation)throw new AppError('NATIVE_OPERATION_SCOPE','Operation does not belong to this document session.',403);
  return operation;
}
function unresolvedViews(operations:ReturnType<typeof recoveryView>[]){
  const uncertain=(status:string)=>['running','queued','unknown'].includes(status);
  return operations.flatMap(op=>[
    ...(uncertain(op.status)?[op.id]:[]),
    ...(op.recovery&&uncertain(op.recovery.status)?[op.recovery.id]:[]),
  ]);
}
export function unresolvedNativeOperations(operations:Operation[],linkId:string,documentId:string){return unresolvedViews(nativeOperations(operations,linkId,documentId));}
export function unresolvedNativeOperationsForStore(store:Store,linkId:string,documentId:string){return unresolvedViews(nativeOperationsForStore(store,linkId,documentId));}
