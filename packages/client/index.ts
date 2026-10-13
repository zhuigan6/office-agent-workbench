import https from 'node:https';
import { randomUUID } from 'node:crypto';

export class ClientError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export interface RequestData {
  url: URL;
  method: 'GET' | 'POST' | 'DELETE';
  headers: Record<string, string>;
  body?: Buffer;
  ca: string;
  timeoutMs: number;
}
export type Transport = (request: RequestData) => Promise<{ status: number; body: Buffer }>;

export const httpsTransport: Transport = ({ url, method, headers, body, ca, timeoutMs }) =>
  new Promise((resolve, reject) => {
    const outgoingHeaders={...headers};
    if(body!==undefined&&!Object.keys(headers).some(key=>['content-length','transfer-encoding'].includes(key.toLowerCase())))outgoingHeaders['Content-Length']=String(body.length);
    const req = https.request(url, { method, headers:outgoingHeaders, ca, rejectUnauthorized: true }, res => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 8 * 1024 * 1024) {
          req.destroy(new ClientError('RESPONSE_LIMIT', 'Response exceeds the client limit.'));
        } else chunks.push(chunk);
      });
      res.on('error', error => { clearTimeout(timer); reject(error); });
      res.on('end', () => {
        clearTimeout(timer);
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) });
      });
    });
    // A wall-clock deadline also covers stalled headers and slow trickle responses.
    const timer = setTimeout(() => req.destroy(new ClientError('TIMEOUT',
      'Request timed out; check shared state before retrying a write.')), timeoutMs);
    req.on('error', error => { clearTimeout(timer); reject(error); });
    req.end(body);
  });

export interface ClientOptions {
  port: number;
  token: string;
  ca: string;
  timeoutMs?: number;
  transport?: Transport;
}

export class WorkbenchClient {
  private readonly transport: Transport;
  readonly origin: string;
  constructor(private readonly options: ClientOptions) {
    if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535 || !options.token ||
        !options.ca || (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0))) {
      throw new ClientError('CONFIG', 'Invalid local connection configuration.');
    }
    this.origin = `https://localhost:${options.port}`;
    this.transport = options.transport ?? httpsTransport;
  }

  private async request(method: 'GET' | 'POST', route: string, body?: Buffer, binary = false): Promise<unknown> {
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${this.options.token}`, Accept: 'application/json' };
      if (body) {
        headers['Content-Type'] = binary ? 'application/octet-stream' : 'application/json';
        headers['Content-Length'] = String(body.length);
      }
      const response = await this.transport({ url: new URL(route, this.origin), method, headers, body,
        ca: this.options.ca, timeoutMs: this.options.timeoutMs ?? 90_000 });
      if (response.status < 200 || response.status >= 300) {
        throw new ClientError('HTTP_ERROR', `Workbench returned HTTP ${response.status}; response details suppressed.`);
      }
      try { return JSON.parse(response.body.toString('utf8')); }
      catch { throw new ClientError('INVALID_RESPONSE', 'Workbench returned invalid JSON.'); }
    } catch (error) {
      if (error instanceof ClientError) throw error;
      throw new ClientError('CONNECTION', 'Cannot reach the trusted local Workbench; check host and certificate.');
    }
  }
  private post(route: string, data: unknown) {
    return this.request('POST', route, Buffer.from(JSON.stringify(data), 'utf8'));
  }
  private conversation(id: string) {
    if (!/^[\w-]+$/.test(id)) throw new ClientError('ARGUMENT', 'Invalid conversation ID.');
    return `/api/conversations/${id}`;
  }
  status() { return this.request('GET', '/api/status'); }
  conversations() { return this.request('GET', '/api/conversations'); }
  nativeSessions() { return this.request('GET', '/api/native-sessions'); }
  private nativeRoute(id: string, action: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new ClientError('ARGUMENT', 'Invalid native session link ID.');
    return `/api/native-sessions/${id}/${action}`;
  }
  nativeEvents(id: string, after = 0) {
    if (!Number.isSafeInteger(after) || after < 0) throw new ClientError('ARGUMENT', 'Invalid native journal cursor.');
    return this.request('GET', `${this.nativeRoute(id, 'events')}?after=${after}`);
  }
  nativeReceipts(id: string, after = 0) {
    if (!Number.isSafeInteger(after) || after < 0) throw new ClientError('ARGUMENT', 'Invalid native receipt cursor.');
    return this.request('GET', `${this.nativeRoute(id, 'receipts')}?after=${after}`);
  }
  nativeSend(id: string, text: string, messageId: string) {
    if (!text.trim() || text.length > 32768 || !/^[\w-]{8,128}$/.test(messageId)) throw new ClientError('ARGUMENT', 'Provide bounded text and an explicit stable native message ID.');
    return this.post(this.nativeRoute(id, 'send'), { messageId, text });
  }
  nativeClose(id: string) { return this.post(this.nativeRoute(id, 'close'), {}); }
  messages(id: string, before?: string) {
    return this.request('GET', `${this.conversation(id)}/messages${before ? `?${new URLSearchParams({ before })}` : ''}`);
  }
  send(id: string, content: string, files: string[] = [], requestId: string = randomUUID()) {
    if (!content.trim() || content.length > 20_000 || files.length > 10) {
      throw new ClientError('ARGUMENT', 'Send requires 1 to 20,000 characters and at most ten file IDs.');
    }
    return this.post(`${this.conversation(id)}/messages`, { requestId, content, ...(files.length ? { files } : {}) });
  }
  files(conversation?: string) {
    return this.request('GET', `/api/files${conversation ? `?${new URLSearchParams({ conversation })}` : ''}`);
  }
  upload(name: string, bytes: Buffer, conversation?: string) {
    if (bytes.length > 32 * 1024 * 1024) throw new ClientError('UPLOAD_LIMIT', 'Upload exceeds 32 MiB.');
    const query = new URLSearchParams({ name, ...(conversation ? { conversation } : {}) });
    return this.request('POST', `/api/files?${query}`, bytes, true);
  }
  file(command: Record<string, unknown>) { return this.post('/api/file-command', command); }
  archives(){return this.request('GET','/api/archives');}
  archive(id:string,offset=0){
    if(!/^[a-f0-9]{64}$/.test(id)||!Number.isSafeInteger(offset)||offset<0)throw new ClientError('ARGUMENT','Use an archive SHA-256 and nonnegative integer offset.');
    return this.request('GET',`/api/archives/${id}?offset=${offset}`);
  }
  importArchive(name:string,bytes:Buffer){
    if(bytes.length>8*1024*1024)throw new ClientError('UPLOAD_LIMIT','History exceeds 8 MiB.');
    return this.request('POST',`/api/archives?${new URLSearchParams({name})}`,bytes,true);
  }
  async access(id: string) {
    const config = await this.post(`${this.conversation(id)}/access`, {});
    const grant = (config as { mcpServers?: { 'office-workbench'?: { env?: { WORKBENCH_TOOL_TOKEN?: unknown } } } } | null)
      ?.mcpServers?.['office-workbench']?.env?.WORKBENCH_TOOL_TOKEN;
    if (grant === this.options.token) throw new ClientError('INVALID_ACCESS', 'A global credential cannot be exported as a scoped grant.');
    return config;
  }
}
