import { ClientError, httpsTransport, type Transport } from './index.ts';

export const toolRoutes = Object.freeze({
  live: '/tools/live',
  capabilities: '/tools/capabilities',
  target: '/tools/target',
  shapes: '/tools/shapes',
  'layout-selection': '/tools/layout-selection',
  'read-range': '/tools/read',
  'write-range': '/tools/write',
  file: '/tools/file',
  'read-text': '/tools/read-text',
  'write-text': '/tools/write-text',
  'write-selection': '/tools/write-selection',
  'replace-selection': '/tools/replace-selection',
  'format-selection': '/tools/format-selection',
} as const);
export type ToolCommand = keyof typeof toolRoutes;
export const inputLimit = 1024 * 1024;
export const responseLimit = 8 * 1024 * 1024;

export function validateConnection(url: string | undefined, token: string | undefined): string {
  // Validate the original spelling: URL normalization otherwise accepts alternate IPs,
  // escaped hosts, whitespace, backslashes and paths that collapse to the origin.
  if (!url || !/^https:\/\/(localhost|127\.0\.0\.1)(?::[1-9][0-9]{0,4})?$/.test(url) ||
      !token || token.length > 8192 || !/^[A-Za-z0-9._~+/-]+=*$/.test(token)) {
    throw new ClientError('CONFIG', 'Invalid scoped connection environment.');
  }
  try { return new URL(url).origin; }
  catch { throw new ClientError('CONFIG', 'Invalid scoped connection environment.'); }
}

export function parseInput(text: string): Record<string, unknown> {
  if (Buffer.byteLength(text, 'utf8') > inputLimit) throw new ClientError('INPUT_LIMIT', 'Input exceeds 1 MiB.');
  let value: unknown;
  try { value = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new ClientError('INPUT_JSON', 'Input must be a JSON object.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ClientError('INPUT_JSON', 'Input must be a JSON object.');
  }
  return value as Record<string, unknown>;
}

export class ScopedClient {
  private readonly origin: string;
  constructor(private readonly options: { url: string; token: string; ca: string; transport?: Transport }) {
    this.origin = validateConnection(options.url, options.token);
    if (!options.ca) throw new ClientError('CONFIG', 'A trusted certificate is required.');
  }

  async invoke(command: ToolCommand, data: Record<string, unknown>): Promise<unknown> {
    if (!Object.hasOwn(toolRoutes, command)) throw new ClientError('ARGUMENT', 'Unknown document tool.');
    const body = Buffer.from(JSON.stringify(data), 'utf8');
    parseInput(body.toString('utf8'));
    let response;
    try {
      response = await (this.options.transport ?? httpsTransport)({
        url: new URL(toolRoutes[command], this.origin), method: 'POST',
        headers: { Authorization: `Bearer ${this.options.token}`, Accept: 'application/json',
          'Content-Type': 'application/json', 'Content-Length': String(body.length) },
        body, ca: this.options.ca, timeoutMs: 90_000,
      });
    } catch {
      throw new ClientError('CONNECTION', 'Trusted local request failed; inspect state before retrying a write.');
    }
    if (response.body.length > responseLimit) throw new ClientError('RESPONSE_LIMIT', 'Response exceeds 8 MiB.');
    if (response.status < 200 || response.status >= 300) {
      throw new ClientError('HTTP_ERROR', 'Workbench rejected the request; details suppressed. Inspect state before retrying.');
    }
    try { return JSON.parse(response.body.toString('utf8')); }
    catch { throw new ClientError('INVALID_RESPONSE', 'Workbench returned invalid JSON.'); }
  }
}
