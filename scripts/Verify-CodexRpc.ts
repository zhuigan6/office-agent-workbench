import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { CodexRpc, NativeRpcRejection } from '../packages/native-sessions/codex-rpc.ts';
import { DatabaseSync } from 'node:sqlite';
import { NativeSessionStore } from '../packages/native-sessions/store.ts';
import { CodexLinkedSession } from '../packages/native-sessions/codex-session.ts';
import { local } from '../apps/local-host/config.ts';

const launcher = process.argv[2];
if (!launcher || !path.isAbsolute(launcher) || path.basename(launcher) !== 'codex.js')
  throw Error('Provide the absolute path to the installed native Codex JS launcher.');
await fs.access(launcher);
const directory = path.join(local, 'verification', 'codex-rpc-' + Date.now());
await fs.mkdir(directory, { recursive: true });
const report: Record<string, unknown> = { modelTurnIssued: false, historyRead: false, globalConfigChanged: false };
let database: DatabaseSync | undefined, session: CodexLinkedSession | undefined;
const child = spawn(process.execPath, [launcher, 'app-server', '--listen', 'stdio://'], {
  cwd: directory, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
});
// Drain but do not log provider diagnostics or credentials.
child.stderr.resume();
const rpc = new CodexRpc(child.stdout, child.stdin);
child.on('error', () => rpc.close());
child.on('exit', () => rpc.close());
let serverRequests = 0;
rpc.on('serverRequest', request => { serverRequests++; rpc.rejectRequest(request.id); });
try {
  const initialized = await rpc.initialize();
  if (!initialized || typeof initialized !== 'object') throw Error('Invalid initialize result.');
  const models = await rpc.request('model/list', { limit: 10 });
  if (!models || typeof models !== 'object' || !Array.isArray((models as any).data)) throw Error('Invalid model list result.');
  Object.assign(report, { initialized: true, modelList: true, listedModelCount: (models as any).data.length, serverRequests });
  if (process.argv.includes('--turn')) {
    const created: any = await rpc.request('thread/start', { cwd: directory, sandbox: 'read-only', approvalPolicy: 'on-request', experimentalRawEvents: false });
    if (typeof created.thread?.id !== 'string') throw Error('Native test thread creation failed.');
    report.createdThread = true;
    database = new DatabaseSync(path.join(directory, 'native-session.sqlite'));
    const store = new NativeSessionStore(database);
    store.link('verification', { linkId: 'verification', threadId: 'local-verification', vendor: 'codex', vendorSessionId: created.thread.id,
      workingDirectory: directory, ownerLink: { principalId: 'verification' }, capabilities: { publicEvents: true, toolEvents: true, sendUserMessages: true } });
    store.acquire('verification', 'verification', 0, 'probe', 'owned-probe', 60_000);
    session = new CodexLinkedSession(store, rpc, 'verification', 'verification', { ownerId: 'probe', launchId: 'owned-probe', ownerEpoch: 1 });
    session.attachCreated(created); report.createdSessionAttached = true;
    report.modelTurnIssued = true;
    const message = await session.send('probe-message', 'Only reply NATIVE_QUEUE_OK. Do not use tools or inspect files.');
    report.queueAccepted = message.state === 'accepted' || message.state === 'completed';
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline && store.message('verification', 'verification', 'probe-message').state !== 'completed') {
      await new Promise(resolve => setTimeout(resolve, 500));
      session.heartbeat();
    }
    const events = store.replay('verification', 'verification', { limit: 100 });
    report.publicKinds = events.items.map(value => value.event.kind);
    report.expectedReply = events.items.some(value => value.event.kind === 'assistant.text' && value.event.text.trim() === 'NATIVE_QUEUE_OK');
    report.completed = store.message('verification', 'verification', 'probe-message').state === 'completed';
    if (!report.completed || !report.expectedReply) throw Error('Native queue/public-event completion was not verified.');
    const resumed: any = await rpc.request('thread/resume', { threadId: created.thread.id });
    report.sameServerResume = resumed.thread?.id === created.thread.id;
    if (!report.sameServerResume) throw Error('Completed native thread did not resume with the same identity.');
  }
} catch (error) {
  report.error = error instanceof Error ? error.message : 'Native probe failed.';
  if (error instanceof NativeRpcRejection) Object.assign(report, { vendorCode: error.vendorCode, rejectionCategory: error.category, diagnosticWords: error.diagnosticWords });
  process.exitCode = 1;
} finally {
  session?.disconnect(); database?.close(); rpc.close(); child.stdin.end();
  if (child.exitCode === null && child.signalCode === null) {
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { child.kill(); resolve(); }, 5000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
  report.ownedProcessStopped = child.exitCode !== null || child.signalCode !== null;
  await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, evidence: directory }));
}
