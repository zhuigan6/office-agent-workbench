import {randomUUID} from 'node:crypto';
import {AppError,canonical,type Operation} from '../contracts/index.ts';
import {selectionSchema,type CapturedSelection} from '../contracts/selection.ts';
import {validateWrite} from '../contracts/index.ts';
import type {DocumentBroker} from './broker.ts';
import {revision} from './store.ts';

export interface SelectionTicket {id:string;conversation:string;capturedAt:number;expiresAt:number;selection:CapturedSelection}
export async function captureBoundSelection(link:{id:string;documentId:string},capture:(documentId:string)=>Promise<unknown>,tickets:SelectionTickets){
  if(!link.documentId?.startsWith('native:'))throw new AppError('SELECTION_NATIVE_REQUIRED','This task must be bound to an open native Office document.',409);
  const selection=selectionSchema.parse(await capture(link.documentId));
  if(selection.documentId!==link.documentId)throw new AppError('SELECTION_SCOPE','Captured selection belongs to another document.',409);
  return tickets.capture(link.id,selection);
}
// Tickets freeze a target, not permission or an assertion that it is still current.
// Callers must authenticate, authorize the document and recheck native revision.
export class SelectionTickets{
  private tickets=new Map<string,SelectionTicket>();
  private continuations=new Map<string,{current:CapturedSelection;operations:Map<string,{before:CapturedSelection;committed:boolean}>}>();
  constructor(private now=Date.now,private ttl=30*60*1000,private maximum=200){
    if(!Number.isFinite(ttl)||ttl<=0||!Number.isSafeInteger(maximum)||maximum<1)throw Error('Invalid selection ticket limits');
  }
  capture(conversation:string,input:unknown){
    if(!conversation||conversation.length>200)throw new AppError('SELECTION_SCOPE','A conversation is required.');
    const selection=selectionSchema.parse(input),time=this.now();
    for(const [id,ticket] of this.tickets)if(ticket.expiresAt<=time){this.tickets.delete(id);this.continuations.delete(id);}
    if(this.tickets.size>=this.maximum)throw new AppError('SELECTION_LIMIT','Too many active selections. Release an old reference before capturing another.',429);
    const ticket:SelectionTicket={id:randomUUID(),conversation,capturedAt:time,expiresAt:time+this.ttl,selection:structuredClone(selection)};
    this.tickets.set(ticket.id,ticket);this.continuations.set(ticket.id,{current:structuredClone(selection),operations:new Map()});return structuredClone(ticket);
  }
  resolve(id:string,conversation:string,documentId:string,hostSessionId:string){
    const selection=this.lookup(id,conversation,documentId);
    if(selection.hostSessionId!==hostSessionId)throw new AppError('SELECTION_SESSION_CHANGED','Office connector restarted; capture again.',409);
    return selection;
  }
  lookup(id:string,conversation:string,documentId:string){
    const ticket=this.tickets.get(id);
    if(!ticket)throw new AppError('SELECTION_MISSING','Capture the selection again.',404);
    if(ticket.conversation!==conversation||ticket.selection.documentId!==documentId)throw new AppError('SELECTION_SCOPE','Selection belongs to another task or document.',403);
    if(ticket.expiresAt<=this.now()){this.tickets.delete(id);this.continuations.delete(id);throw new AppError('SELECTION_EXPIRED','Selection reference expired; capture again.',409);}
    return structuredClone(this.continuations.get(id)?.current??ticket.selection);
  }
  forOperation(id:string,conversation:string,documentId:string,operationId:string){
    const current=this.lookup(id,conversation,documentId),state=this.continuations.get(id)!;
    if(!/^[A-Za-z0-9_-]{1,100}$/.test(operationId))throw new AppError('INVALID_OPERATION_ID','A stable bounded operation ID is required.');
    const previous=state.operations.get(operationId);if(previous)return structuredClone(previous.before);
    if(state.operations.size>=100)throw new AppError('SELECTION_OPERATION_LIMIT','This reference reached100 operations. Capture a new explicit reference.',409);
    state.operations.set(operationId,{before:structuredClone(current),committed:false});return current;
  }
  complete(id:string,conversation:string,documentId:string,operation:Operation){
    // Only trusted verified journal results can advance a cursor; never reread and
    // adopt an arbitrary new current selection. Original capture and TTL stay fixed.
    try{this.lookup(id,conversation,documentId);}catch{return {status:'unavailable',instruction:'Capture a new explicit reference before further editing.'};}
    const state=this.continuations.get(id)!,record=state.operations.get(operation.id),result=operation.result as any,payload=operation.payload as any;
    if(!record||operation.documentId!==documentId||operation.status!=='applied'||result?.verified!==true)return {status:'not-advanced'};
    if(record.committed)return {status:'already-applied',selectionId:id,revision:state.current.contentHash};
    if(canonical(state.current)!==canonical(record.before))return {status:'not-advanced',instruction:'Reference advanced elsewhere; inspect before another edit.'};
    const before=record.before;let next:CapturedSelection;
    if(!/^[a-f0-9]{64}$/.test(result.revision??''))return {status:'not-advanced'};
    if(before.kind==='word'&&(operation.kind==='word.format'||operation.kind==='word.replace')){
      if(canonical(payload?.selection)!==canonical(before)||result.after?.contentHash!==result.revision)return {status:'not-advanced'};
      const candidate=result.after.selection;
      if(candidate?.kind!=='word'||candidate.documentId!==before.documentId||candidate.hostSessionId!==before.hostSessionId||candidate.storyType!==before.storyType||candidate.start!==before.start)return {status:'not-advanced'};
      if(operation.kind==='word.replace'&&(typeof payload.text!=='string'||result.after.text!==payload.text))return {status:'not-advanced'};
      const end=operation.kind==='word.replace'?before.start+payload.text.length:before.end;
      if(candidate.end!==end)return {status:'not-advanced'};
      next=selectionSchema.parse({...before,end,contentHash:result.revision,preview:operation.kind==='word.replace'?String(result.after.text).slice(0,4000):before.preview});
    }else if(before.kind==='excel'&&operation.kind==='excel.write'){
      if(payload?.expectedRevision!==before.expectedRevision||payload.sheet!==before.sheet||payload.range!==before.range||result.after?.sheetName!==before.sheet||result.after?.address!==before.range||revision(result.after)!==result.revision)return {status:'not-advanced'};
      next=selectionSchema.parse({...before,expectedRevision:result.revision,contentHash:result.revision});
    }else if(before.kind==='powerpoint'&&(operation.kind==='ppt.format'||operation.kind==='ppt.layout')){
      if(canonical(payload?.selection)!==canonical(before))return {status:'not-advanced'};
      if(operation.kind==='ppt.format'){
        if(result.after?.contentHash!==result.revision)return {status:'not-advanced'};
        next=selectionSchema.parse({...before,contentHash:result.revision});
      }else{
        const parsed=selectionSchema.safeParse(result.continuationSelection);
        if(!parsed.success)return {status:'not-advanced',instruction:'This operation lacks a verified continuation snapshot. Capture a new reference.'};
        const candidate=parsed.data;
        if(candidate.kind!=='powerpoint'||candidate.documentId!==before.documentId||candidate.hostSessionId!==before.hostSessionId||candidate.slideId!==before.slideId||canonical(candidate.shapeIds)!==canonical(before.shapeIds)||candidate.textStart!==before.textStart||candidate.textLength!==before.textLength||candidate.layoutRevision!==result.revision)return {status:'not-advanced'};
        const expectedHash=result.afterText?.contentHash??result.revision;
        if(candidate.contentHash!==expectedHash||(payload.expectedTextFingerprint&&result.beforeText?.contentHash!==payload.expectedTextFingerprint))return {status:'not-advanced'};
        next=candidate;
      }
    }else return {status:'not-advanced'};
    state.current=next;record.committed=true;
    return {status:'advanced',selectionId:id,revision:next.contentHash};
  }
  release(id:string,conversation:string){const ticket=this.tickets.get(id);if(ticket&&ticket.conversation!==conversation)throw new AppError('SELECTION_SCOPE','Selection belongs to another task.',403);this.tickets.delete(id);this.continuations.delete(id);}
}

export async function writeExcelSelection(tickets:SelectionTickets,broker:DocumentBroker,scope:{conversation:string;documentId:string},input:{selectionId:string;operationId:string;values?:unknown;formulas?:unknown;numberFormat?:unknown},verifyIdentity:(selection:CapturedSelection)=>Promise<void>){
  const selection=tickets.forOperation(input.selectionId,scope.conversation,scope.documentId,input.operationId);
  if(selection.kind!=='excel')throw new AppError('SELECTION_EDIT_UNSUPPORTED','This operation requires an Excel selection.');
  const request=validateWrite({documentId:selection.documentId,sheet:selection.sheet,range:selection.range,expectedRevision:selection.expectedRevision,operationId:input.operationId,
    ...(input.values!==undefined?{values:input.values}:{}),...(input.formulas!==undefined?{formulas:input.formulas}:{}),...(input.numberFormat!==undefined?{numberFormat:input.numberFormat}:{})});
  return broker.write(request,async()=>{tickets.lookup(input.selectionId,scope.conversation,scope.documentId);await verifyIdentity(selection);});
}
