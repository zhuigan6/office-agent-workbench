import { randomUUID } from 'node:crypto';
import { AppError, canonical, rangeDimensions, validateWrite, type DocumentBinding, type Operation, type RangeState } from '../contracts/index.ts';
import { Store, revision } from './store.ts';
import { hostTextReadSchema, hostTextWriteSchema } from '../contracts/host-text.ts';

export interface Host {
  binding: DocumentBinding;
  request(method: string, payload: unknown): Promise<any>;
}
export class DocumentBroker {
  hosts = new Map<string, Host>();
  queues = new Map<string, Promise<unknown>>();
  inFlight = new Map<string, Promise<Operation>>();
  constructor(public store: Store) {}
  attach(host: Host) {
    const old = this.hosts.get(host.binding.documentId);
    if (old && old.binding.hostSessionId !== host.binding.hostSessionId)
      throw new AppError('ALREADY_BOUND', 'This document is bound in another Office window.', 409);
    this.hosts.set(host.binding.documentId, host);
    this.store.bind(host.binding);
  }
  detach(host: Host) {
    if (this.hosts.get(host.binding.documentId) === host) {
      this.hosts.delete(host.binding.documentId);
      this.store.event('document.disconnected', { documentId: host.binding.documentId });
    }
  }
  host(documentId: string) {
    const host = this.hosts.get(documentId);
    if (!host) throw new AppError('OFFICE_OFFLINE', 'Open and connect the document in Office.', 409);
    return host;
  }
  async read(documentId: string, sheet: string, range: string) {
    rangeDimensions(range);
    const state: RangeState = await this.host(documentId).request('read', { sheet, range });
    if(canonical(state).length>512000)throw new AppError('READ_TOO_LARGE','This range contains too much text. Read a smaller range before editing.',413);
    return { ...state, revision: revision(state) };
  }
  async write(input: unknown, beforeRead?:()=>Promise<void>): Promise<Operation> {
    const data = validateWrite(input);
    const { operation, fresh } = this.store.begin(data.operationId, data.documentId, 'excel.write', data);
    if (!fresh) return this.inFlight.get(operation.id) ?? operation;
    const previous = this.queues.get(data.documentId) ?? Promise.resolve();
    const execution = previous.catch(() => {}).then(async () => {
      let issued = false;
      let before:unknown;
      try {
        const host = this.host(data.documentId);
        this.store.updateOperation(operation.id, 'running', null);
        await beforeRead?.();
        const current = await this.read(data.documentId, data.sheet, data.range);
        if (current.revision !== data.expectedRevision)
          return this.store.updateOperation(operation.id, 'conflict', { code: 'REVISION_CONFLICT', current });
        before=current;
        this.store.updateOperation(operation.id,'running',{before});
        issued = true;
        const result = await host.request('write', { ...data, before: current });
        if (result.code === 'REVISION_CONFLICT') return this.store.updateOperation(operation.id, 'conflict', result);
        if(result.notIssued===true)return this.store.updateOperation(operation.id,'failed',result);
        if (!result.verified) return this.store.updateOperation(operation.id, 'unknown', result);
        return this.store.updateOperation(operation.id, 'applied', result);
      } catch (error) {
        return this.store.updateOperation(operation.id, issued ? 'unknown' : 'failed', {
          code: error instanceof AppError ? error.code : 'HOST_ERROR',
          message: error instanceof Error ? error.message : String(error),
          ...(before?{before}:{}),
        });
      }
    });
    this.queues.set(data.documentId, execution);
    this.inFlight.set(operation.id, execution);
    try { return await execution; }
    finally {
      this.inFlight.delete(operation.id);
      if (this.queues.get(data.documentId) === execution) this.queues.delete(data.documentId);
    }
  }
  async readText(documentId:string,input:unknown) {
    const host=this.host(documentId);if(!host.binding.capabilities.includes('readText'))throw new AppError('UNSUPPORTED','This host does not support text reads.');
    return host.request('readText',hostTextReadSchema.parse(input));
  }
  async writeText(documentId:string,input:unknown):Promise<Operation>{
    const data=hostTextWriteSchema.parse(input);
    if(!data.operationId)throw new AppError('OPERATION_REQUIRED','Supply a unique operationId.');
    const started=this.store.begin(data.operationId,documentId,'text.write',data);
    if(!started.fresh)return this.inFlight.get(started.operation.id) ?? started.operation;
    const execution=(this.queues.get(documentId) || Promise.resolve()).catch(()=>{}).then(async()=>{
      let issued=false;
      let before:unknown;
      try{
        const host=this.host(documentId);if(!host.binding.capabilities.includes('writeText'))throw new AppError('UNSUPPORTED','This host does not support text edits.');
        this.store.updateOperation(data.operationId!,'running',null);issued=true;
        const result=await host.request('writeText',{...data,onBeforeWrite:(state:unknown)=>{before=state;this.store.updateOperation(data.operationId!,'running',{before});}});
        if(result.notIssued===true)return this.store.updateOperation(data.operationId!,'failed',result);
        return this.store.updateOperation(data.operationId!,result.code==='REVISION_CONFLICT'?'conflict':result.verified?'applied':'unknown',result);
      }catch(error){return this.store.updateOperation(data.operationId!,issued?'unknown':'failed',{message:error instanceof Error?error.message:String(error),...(before?{before}:{})});}
    });
    this.queues.set(documentId,execution);this.inFlight.set(data.operationId,execution);
    try{return await execution;}finally{this.inFlight.delete(data.operationId);if(this.queues.get(documentId)===execution)this.queues.delete(documentId);}
  }
  async snapshot(documentId: string) {const host=this.host(documentId);if(!host.binding.capabilities.includes('snapshot'))throw new AppError('UNSUPPORTED','This Office host cannot export a compressed snapshot.');return host.request('snapshot', { requestId: randomUUID() }); }
}
