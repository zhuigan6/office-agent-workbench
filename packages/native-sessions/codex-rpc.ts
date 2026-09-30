import { EventEmitter } from 'node:events';
import type { Readable, Writable } from 'node:stream';
import { AppError } from '../contracts/index.ts';

type RpcId = string | number;
export interface CodexNotification { method: string; params: unknown }
export interface CodexServerRequest extends CodexNotification { id: RpcId }
interface Pending { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
const MAX_FRAME = 8 * 1024 * 1024;
const MAX_PENDING = 64;
export class NativeRpcRejection extends AppError {
  readonly vendorCode: number | null;
  readonly category: string;
  readonly diagnosticWords: string[];
  constructor(input: unknown) {
    super('NATIVE_VENDOR_ERROR', 'Native server rejected the request.', 502);
    const error = input as any;
    this.vendorCode = Number.isSafeInteger(error?.code) ? error.code : null;
    const message = typeof error?.message === 'string' ? error.message : '';
    const words = new Set(message.toLowerCase().match(/[a-z]+/g) ?? []);
    this.diagnosticWords = ['client', 'registered', 'allowed', 'policy', 'capability', 'required', 'missing', 'initialize', 'initialized', 'request', 'thread', 'start', 'unsupported', 'invalid', 'deprecated', 'backend', 'account', 'unavailable', 'timeout', 'cwd', 'path', 'expected', 'object', 'boolean', 'string', 'null', 'field', 'feature', 'disabled', 'version', 'originator', 'session', 'name', 'instructions', 'empty', 'create', 'creating', 'new', 'base', 'model', 'provider', 'response', 'context', 'prompt', 'read', 'write', 'failed', 'error', 'load', 'spawn', 'directory', 'exists', 'not', 'found', 'git', 'repository', 'trusted', 'trust', 'stream', 'transport', 'endpoint', 'connection', 'connect', 'socket', 'server', 'network', 'quota', 'limit', 'usage', 'token', 'tokens', 'type', 'deserialize', 'parse', 'utf', 'cannot', 'internal', 'params', 'permission', 'denied', 'id', 'crash', 'panic', 'persist', 'persisted', 'history', 'sql', 'sqlite', 'database', 'lock', 'locked', 'unregistered', 'metadata'].filter(word => words.has(word));
    this.category = ['unknown method', 'unknown variant', 'missing field', 'not initialized', 'experimental', 'routing', 'workspace', 'sandbox', 'configuration', 'config', 'authentication', 'unauthorized', 'model', 'permission', 'invalid params']
      .find(word => message.toLowerCase().includes(word)) ?? 'unspecified';
  }
}

/** A single explicit connection. Never reconnect/replay potentially dispatched requests. */
export class CodexRpc extends EventEmitter {
  private pending = new Map<RpcId, Pending>();
  private buffer = Buffer.alloc(0);
  private nextId = 0;
  private closed = false;
  private ready = false;
  private initializing = false;
  private serverRequests = new Set<RpcId>();
  private readonly onData = (chunk: Buffer | string) => this.receive(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  private readonly onEnd = () => this.close();
  private readonly onError = () => this.close();

  constructor(private input: Readable, private output: Writable, private timeoutMs = 30_000) {
    super();
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new AppError('NATIVE_INVALID_INPUT', 'Invalid native RPC timeout.');
    input.on('data', this.onData); input.on('end', this.onEnd); input.on('error', this.onError);
    output.on('error', this.onError); output.on('close', this.onEnd);
  }

  async initialize() {
    if (this.ready || this.initializing) throw new AppError('NATIVE_STATE_CONFLICT', 'Native connection is already initializing or initialized.', 409);
    this.initializing = true;
    try {
    const result = await this.request('initialize', {
      clientInfo: { name: 'office_agent_workbench', title: 'Office Agent Workbench', version: '0.1.0-alpha.2' },
      capabilities: { experimentalApi: true },
    });
    this.notify('initialized', {}); this.ready = true; return result;
    } catch (error) { this.close(); throw error; }
    finally { this.initializing = false; }
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(new AppError('NATIVE_DISCONNECTED', 'Native connection is closed.', 503));
    if (!this.ready && method !== 'initialize') return Promise.reject(new AppError('NATIVE_NOT_READY', 'Initialize the native connection first.', 409));
    if (this.pending.size >= MAX_PENDING) return Promise.reject(new AppError('NATIVE_RPC_LIMIT', 'Too many native requests.', 429));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AppError('NATIVE_DISPATCH_UNCERTAIN', 'Native request timed out; do not automatically resend.', 504));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  notify(method: string, params: unknown) { this.write({ method, params }); }

  respond(id: RpcId, result: unknown) {
    if (!this.serverRequests.has(id)) throw new AppError('NATIVE_UNKNOWN_REQUEST', 'Native approval request is no longer pending.', 409);
    this.write({ id, result }); this.serverRequests.delete(id);
  }

  rejectRequest(id: RpcId) {
    if (!this.serverRequests.has(id)) throw new AppError('NATIVE_UNKNOWN_REQUEST', 'Native approval request is no longer pending.', 409);
    this.write({ id, error: { code: -32000, message: 'Explicit user approval is required.' } }); this.serverRequests.delete(id);
  }

  private write(frame: unknown) {
    if (this.closed) throw new AppError('NATIVE_DISCONNECTED', 'Native connection is closed.', 503);
    const encoded = JSON.stringify(frame);
    if (Buffer.byteLength(encoded) > MAX_FRAME) throw new AppError('NATIVE_RPC_LIMIT', 'Native frame exceeds size limits.');
    this.output.write(encoded + '\n', error => { if (error) this.close(); });
  }

  private receive(chunk: Buffer) {
    if (this.closed) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    let newline: number;
    while ((newline = this.buffer.indexOf(10)) !== -1) {
      if (newline > MAX_FRAME) { this.close(); return; }
      const line = this.buffer.subarray(0, newline); this.buffer = this.buffer.subarray(newline + 1);
      if (!line.toString('utf8').trim()) continue;
      try {
        const frame = JSON.parse(line.toString('utf8'));
        if (!frame || typeof frame !== 'object' || Array.isArray(frame)) throw Error('Invalid frame');
        if (typeof frame.method === 'string') {
          if (frame.id !== undefined) {
            if ((typeof frame.id !== 'string' && typeof frame.id !== 'number') || this.serverRequests.has(frame.id) || this.serverRequests.size >= MAX_PENDING) throw Error('Invalid request');
            this.serverRequests.add(frame.id);
            if (this.listenerCount('serverRequest')) this.emit('serverRequest', { id: frame.id, method: frame.method, params: frame.params });
            else this.rejectRequest(frame.id);
          } else this.emit('notification', { method: frame.method, params: frame.params });
        } else {
          const pending = this.pending.get(frame.id);
          if (!pending) continue;
          if (!('result' in frame) && !('error' in frame)) throw Error('Invalid response');
          clearTimeout(pending.timer); this.pending.delete(frame.id);
          if ('error' in frame) pending.reject(new NativeRpcRejection(frame.error));
          else pending.resolve(frame.result);
        }
      } catch { this.close(); return; }
    }
    if (this.buffer.length > MAX_FRAME) this.close();
  }

  close() {
    if (this.closed) return;
    this.closed = true; this.ready = false;
    this.input.off('data', this.onData); this.input.off('end', this.onEnd); this.input.off('error', this.onError);
    this.output.off('error', this.onError); this.output.off('close', this.onEnd);
    this.buffer = Buffer.alloc(0); this.serverRequests.clear();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new AppError('NATIVE_DISPATCH_UNCERTAIN', 'Native connection closed; dispatch outcome may be unknown.', 503));
    }
    this.pending.clear(); this.emit('disconnected');
  }
}
