import { createHash } from 'node:crypto';
import { AppError } from '../contracts/index.ts';

export const nativeBaselines = Object.freeze({ codex: '0.159.2', claude: '2.1.282' });
type Schema = Record<string, any>;
export interface CodexSchemaBundle {
  requests: Schema; notifications: Schema; queueResponse: Schema;
}

export function nativeVersion(vendor: keyof typeof nativeBaselines, output: string): string {
  const pattern = vendor === 'codex' ? /^codex-cli (\d+\.\d+\.\d+(?:-[\w.-]+)?)$/ : /^(\d+\.\d+\.\d+(?:-[\w.-]+)?) \(Claude Code\)$/;
  const match = output.trim().match(pattern);
  if (!match) throw new AppError('NATIVE_VERSION_UNKNOWN', 'Native version output is not recognized; do not infer compatibility.');
  return match[1];
}

function resolve(root: Schema, input: any): Schema | undefined {
  let value = input;
  for (let depth = 0; depth < 12; depth++) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    if (!value.$ref) return value;
    if (typeof value.$ref !== 'string' || !value.$ref.startsWith('#/')) return;
    value = value.$ref.slice(2).split('/').reduce((current: any, key: string) => {
      key = key.replaceAll('~1', '/').replaceAll('~0', '~');
      return current && Object.hasOwn(current, key) ? current[key] : undefined;
    }, root);
  }
}

function methods(root: Schema): Map<string, Schema> {
  const result = new Map<string, Schema>();
  for (const candidate of root.oneOf ?? root.anyOf ?? []) {
    const variant = resolve(root, candidate), method = variant?.properties?.method;
    const name = method?.const ?? (method?.enum?.length === 1 ? method.enum[0] : undefined);
    if (typeof name !== 'string') continue;
    const params = resolve(root, variant?.properties?.params);
    if (params) result.set(name, params);
  }
  return result;
}

/** Capability shape checks, NOT a claim that a new release passed functional acceptance. */
export function inspectCodexProtocol(bundle: CodexSchemaBundle) {
  const requests = methods(bundle.requests), notifications = methods(bundle.notifications), reasons: string[] = [];
  const check = (method: string, supplied: string[]) => {
    const params = requests.get(method);
    if (!params) { reasons.push('missing-method:' + method); return false; }
    for (const field of supplied) if (!Object.hasOwn(params.properties ?? {}, field)) reasons.push('missing-field:' + method + ':' + field);
    for (const field of params.required ?? []) if (!supplied.includes(field)) reasons.push('new-required-field:' + method + ':' + field);
    return !reasons.some(reason => reason.includes(':' + method));
  };
  const initialize = check('initialize', ['clientInfo', 'capabilities']);
  const resume = check('thread/resume', ['threadId']);
  const read = check('thread/read', ['threadId', 'includeTurns']);
  const queue = check('thread/queue/add', ['threadId', 'clientUserMessageId', 'input']);
  const queueObject = resolve(bundle.queueResponse, bundle.queueResponse.properties?.queuedSubmission);
  const receipt = ['id', 'clientUserMessageId'].every(field => resolve(bundle.queueResponse, queueObject?.properties?.[field])?.type === 'string');
  if (!receipt) reasons.push('changed-queue-receipt');
  const events = ['turn/started', 'turn/completed', 'item/started', 'item/completed'].every(method => {
    const params = notifications.get(method);
    const valid = Boolean(params?.properties?.threadId && (method.startsWith('turn/') ? params.properties.turn : params?.properties?.item));
    if (!valid) reasons.push('changed-public-event:' + method);
    return valid;
  });
  const digest = createHash('sha256').update(JSON.stringify(bundle)).digest('hex');
  const optional=(method:string,fields:string[])=>{
    const params=requests.get(method);return Boolean(params&&fields.every(field=>Object.hasOwn(params.properties??{},field))&&(params.required??[]).every((field:string)=>fields.includes(field)));
  };
  const cancellationShape=optional('turn/interrupt',['threadId','turnId'])&&optional('thread/queue/list',['threadId','limit'])&&optional('thread/queue/start',['threadId','queuedSubmissionId']);
  return { fingerprint: digest, sessionRead: initialize && resume && read, queuedSend: initialize && queue && receipt, publicEvents: events,
    compatibleShape: initialize && resume && read && queue && receipt && events, cancellationShape, reasons };
}

export function compatibilityState(vendor: keyof typeof nativeBaselines, version: string, evidence?: {
  version: string; fingerprint: string; protocolPassed: boolean; functionalPassed: boolean;
}, currentFingerprint?: string) {
  const exactEvidence = evidence?.version === version && Boolean(currentFingerprint) && evidence.fingerprint === currentFingerprint;
  return { vendor, version, testedBaseline: nativeBaselines[vendor],
    state: exactEvidence && evidence?.protocolPassed && evidence.functionalPassed ? 'accepted' :
      exactEvidence && evidence?.protocolPassed ? 'protocol-only' : 'needs-validation',
    automaticUpgrade: false, baselineMatch: version === nativeBaselines[vendor] };
}
