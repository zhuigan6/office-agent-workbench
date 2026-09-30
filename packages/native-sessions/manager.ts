import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import type { DatabaseSync } from 'node:sqlite';
import { AppError } from '../contracts/index.ts';
import { parseNative, type NativeOwner } from '../contracts/native-session.ts';
import { NativeSessionStore } from './store.ts';
import { CodexRpc } from './codex-rpc.ts';
import { CodexLinkedSession } from './codex-session.ts';
import { findCodexLauncher, findCodexBinary, inspectCodexRuntime } from './codex-runtime.ts';
import { startCodexServer } from './codex-server.ts';

const principal = 'local-workbench-user';
const createSchema = z.object({ name: z.string().trim().min(1).max(100) }).strict();
interface Runtime { server: Awaited<ReturnType<typeof startCodexServer>>; binaryHash: string; rpc: CodexRpc; session: CodexLinkedSession; owner: NativeOwner; timer: ReturnType<typeof setInterval> }

/** Existing installed native runtime, thin protocol adapter; no vendor transcript writes. */
export class NativeSessions {
  readonly store: NativeSessionStore;
  private runtimes = new Map<string, Runtime>();
  private creating = false;
  private closing = false;
  constructor(db: DatabaseSync, private dataRoot: string, private publish: (link: string) => void) {
    this.store = new NativeSessionStore(db);
    db.exec('CREATE TABLE IF NOT EXISTS native_session_metadata (link TEXT PRIMARY KEY, name TEXT NOT NULL, runtime TEXT NOT NULL)');
    this.db = db;
  }
  private db: DatabaseSync;

  get busy() {
    return this.creating || [...this.runtimes.keys()].some(id => {
      const link = this.store.get(id, principal);
      return Boolean(link.activeTurnId) || this.store.hasPending(id, principal);
    });
  }
  private summary(id: string) {
    const link = this.store.get(id, principal), row = this.db.prepare('SELECT name,runtime FROM native_session_metadata WHERE link=?').get(id);
    return { ...link, name: row?.name ?? 'Native session', runtime: row ? JSON.parse(String(row.runtime)) : null,
      connected: this.runtimes.has(id), pending: this.store.hasPending(id, principal) || Boolean(link.activeTurnId),
      terminalSharing: this.runtimes.has(id), documentToolsConnected: false };
  }
  list(after = 0) { const page = this.store.list(principal, { after, limit: 100 }); return { ...page, items: page.items.map(link => this.summary(link.linkId)) }; }
  events(id: string, after = 0) { return this.store.replay(id, principal, { after, limit: 100 }); }
  receipts(id: string, after = 0) { return this.store.messages(id, principal, { after, limit: 100 }); }

  async create(input: unknown) {
    const data = parseNative(createSchema, input);
    if (this.creating || this.closing) throw new AppError('NATIVE_TURN_CONFLICT', 'Native runtime setup is already active.', 409);
    if (this.runtimes.size >= 4) throw new AppError('NATIVE_RPC_LIMIT', 'Close an idle native runtime before opening another.', 429);
    this.creating = true;
    let server: Awaited<ReturnType<typeof startCodexServer>> | undefined, rpc: CodexRpc | undefined, linkId: string | undefined;
    try {
      const evidence = path.join(this.dataRoot, 'verification'); await fs.mkdir(evidence, { recursive: true });
      const check = await inspectCodexRuntime(await findCodexLauncher(), evidence);
      if (!check.protocol.compatibleShape) throw new AppError('NATIVE_VERSION_UNSUPPORTED', 'Installed Codex protocol changed; compatibility validation is required.', 409);
      if (createHash('sha256').update(await fs.readFile(check.launcher)).digest('hex') !== check.launcherHash)
        throw new AppError('NATIVE_RUNTIME_CHANGED', 'Codex changed during validation; start a fresh explicit setup.', 409);
      const workspace = path.join(this.dataRoot, 'native-workspaces', randomUUID()); await fs.mkdir(workspace, { recursive: true });
      const native = await findCodexBinary(check.launcher);
      server = await startCodexServer(native.binary, workspace); rpc = server.rpc;
      const acknowledgement: any = await rpc.request('thread/start', { cwd: workspace, sandbox: 'read-only', approvalPolicy: 'on-request', experimentalRawEvents: false });
      if (acknowledgement.sandbox?.type !== 'readOnly') throw new AppError('NATIVE_SOURCE_MISMATCH', 'Owned Codex session did not confirm read-only permissions.', 409);
      linkId = randomUUID();
      this.store.link(principal, { linkId, threadId: linkId, vendor: 'codex', vendorSessionId: acknowledgement.thread?.id,
        workingDirectory: workspace, ownerLink: { principalId: principal }, capabilities: { publicEvents: true, sendUserMessages: true, toolEvents: true } });
      const owner: NativeOwner = { ownerId: 'workbench-host', launchId: randomUUID(), ownerEpoch: 1 };
      this.store.acquire(linkId, principal, 0, owner.ownerId, owner.launchId, 60_000);
      this.db.prepare('INSERT INTO native_session_metadata VALUES(?,?,?)').run(linkId, data.name, JSON.stringify({ version: check.version, protocolFingerprint: check.protocol.fingerprint, evidence: check.evidence, binaryHash: native.binaryHash, transport: 'authenticated-loopback' }));
      const session = new CodexLinkedSession(this.store, rpc, linkId, principal, owner);
      session.attachCreated(acknowledgement);
      const id = linkId;
      session.on('publicEvent', () => this.publish(id));
      session.on('fenced', () => this.publish(id));
      const timer = setInterval(() => { try { session.heartbeat(); } catch { session.disconnect(); } }, 15_000); timer.unref();
      const runtime = { server, binaryHash: native.binaryHash, rpc, session, owner, timer };
      this.runtimes.set(id, runtime);
      server.child.once('exit', () => { clearInterval(timer); session.disconnect(); this.runtimes.delete(id); this.publish(id); });
      this.publish(id); return this.summary(id);
    } catch (error) {
      rpc?.close(); await server?.stop();
      if (error instanceof AppError) throw error;
      throw new AppError('NATIVE_START_FAILED', 'Native runtime setup failed; no existing conversation was replaced.', 503);
    } finally { this.creating = false; }
  }

  async terminal(id: string) {
    const link = this.store.get(id, principal), runtime = this.runtimes.get(id);
    if (!runtime || link.owner?.status !== 'active')
      throw new AppError('NATIVE_OWNER_UNCERTAIN', 'Connect only to an active, verified owned session.', 409);
    if (createHash('sha256').update(await fs.readFile(runtime.server.binary)).digest('hex') !== runtime.binaryHash)
      throw new AppError('NATIVE_RUNTIME_CHANGED', 'Codex was upgraded while this session was running; validate continuation before attaching another terminal.', 409);
    const clientHome = path.join(this.dataRoot, 'native-terminal-homes', randomUUID());
    await fs.mkdir(clientHome, { recursive: true });
    return { endpoint: runtime.server.endpoint, token: runtime.server.token, binary: runtime.server.binary,
      threadId: link.vendorSessionId, workspace: link.workingDirectory, clientHome };
  }

  async send(id: string, input: unknown) {
    const runtime = this.runtimes.get(id);
    if (!runtime) { this.store.get(id, principal); throw new AppError('NATIVE_OWNER_UNCERTAIN', 'Native session is offline. Existing history is retained; do not create a replacement implicitly.', 409); }
    const message = parseNative(z.object({ messageId: z.string().min(1).max(200), text: z.string().min(1).max(32768) }).strict(), input);
    const result = await runtime.session.send(message.messageId, message.text); this.publish(id); return result;
  }

  async close(id: string) {
    const runtime = this.runtimes.get(id); this.store.get(id, principal);
    if (!runtime) return { closed: true, historyRetained: true };
    const link = this.store.get(id, principal);
    if (link.activeTurnId || this.store.hasPending(id, principal))
      throw new AppError('NATIVE_TURN_CONFLICT', 'An active or uncertain native request prevents idle shutdown.', 409);
    await this.stopRuntime(runtime); this.runtimes.delete(id); this.publish(id);
    return { closed: true, historyRetained: true };
  }

  private async stopRuntime(runtime: Runtime) {
    clearInterval(runtime.timer); runtime.session.disconnect(); await runtime.server.stop();
  }
  async stopAll() { this.closing = true; for (const runtime of this.runtimes.values()) await this.stopRuntime(runtime); this.runtimes.clear(); }
}
