import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { TavusError, type TavusApi } from './client.js';
import { LifecycleTimings, type StageOutcome } from '../observability/lifecycle.js';

export interface ResourceRecord {
  sessionId: string; expiresAt: number; palId?: string; conversationId?: string;
  pending?: 'pal' | 'conversation'; outcomeUnknown?: boolean;
  closing: boolean; remoteEnded: boolean; palDeleted: boolean; cleanupAttempts: number;
}

function validRecord(value: unknown): value is ResourceRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  const id = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 256;
  return id(r.sessionId) && typeof r.expiresAt === 'number' && Number.isFinite(r.expiresAt)
    && ['closing', 'remoteEnded', 'palDeleted'].every(k => typeof r[k] === 'boolean')
    && Number.isSafeInteger(r.cleanupAttempts) && Number(r.cleanupAttempts) >= 0
    && (r.palId === undefined || id(r.palId)) && (r.conversationId === undefined || id(r.conversationId))
    && (r.pending === undefined || r.pending === 'pal' || r.pending === 'conversation')
    && (r.outcomeUnknown === undefined || typeof r.outcomeUnknown === 'boolean')
    && !(r.conversationId && !r.palId)
    && !(r.palDeleted && (r.pending || r.outcomeUnknown))
    && !(r.conversationId && r.palDeleted && !r.remoteEnded)
    && Object.keys(r).every(k => ['sessionId', 'expiresAt', 'palId', 'conversationId', 'pending', 'outcomeUnknown', 'closing', 'remoteEnded', 'palDeleted', 'cleanupAttempts'].includes(k));
}

// Only resource IDs/intents are durable. No room token, learner data, API key or transcript.
export class ResourceLedger {
  records = new Map<string, ResourceRecord>();
  private queue: Promise<void> = Promise.resolve();
  constructor(private path: string) {}
  async load() {
    try {
      const text = await readFile(this.path, 'utf8');
      let records: unknown;
      try { records = JSON.parse(text); } catch { throw new Error('invalid_ledger'); }
      if (!Array.isArray(records) || !records.every(validRecord) || new Set(records.map(r => r.sessionId)).size !== records.length) throw new Error('invalid_ledger');
      const next = new Map<string, ResourceRecord>();
      for (const record of records) {
        // A process died during creation: reconcile before any retry/deletion.
        if (record.pending) record.outcomeUnknown = true;
        next.set(record.sessionId, record);
      }
      this.records = next;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  async save() {
    const data = JSON.stringify([...this.records.values()], null, 2);
    const operation = this.queue.then(async () => {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      await writeFile(`${this.path}.tmp`, data, { mode: 0o600 });
      await rename(`${this.path}.tmp`, this.path);
    });
    this.queue = operation.catch(() => {});
    await operation;
  }
}

export class Resources {
  private cleaning = new Map<string, Promise<void>>();
  private creating = new Map<string, Promise<void>>();
  constructor(public ledger: ResourceLedger, private api: TavusApi, public timings = new LifecycleTimings()) {}
  async create(sessionId: string, expiresAt: number, pal: Record<string, unknown>, conversation: (palId: string) => Record<string, unknown>) {
    if (this.ledger.records.has(sessionId)) throw new Error('resource_creation_already_attempted');
    let finish!: () => void;
    this.creating.set(sessionId, new Promise<void>(resolve => { finish = resolve; }));
    try {
      const joined = await this.createTracked(sessionId, expiresAt, pal, conversation);
      if (this.ledger.records.get(sessionId)?.closing) throw new Error('resource_creation_cancelled');
      return joined;
    }
    catch (error) {
      // Release creation before awaiting cleanup: concurrent end requests may
      // already be waiting on this creation's IDs to settle.
      this.creating.delete(sessionId); finish();
      await this.cleanup(sessionId).catch(() => {});
      throw error;
    } finally { this.creating.delete(sessionId); finish(); }
  }
  private async remoteCreate<T>(r: ResourceRecord, kind: 'pal' | 'conversation', call: () => Promise<T>) {
    r.pending = kind;
    try { await this.ledger.save(); }
    catch (error) { r.pending = undefined; throw error; } // No network call was made.
    if (r.closing) { r.pending = undefined; throw new Error('resource_creation_cancelled'); }
    try { return await call(); }
    catch (error) {
      r.outcomeUnknown = !(error instanceof TavusError) || error.outcomeUnknown;
      if (!r.outcomeUnknown) r.pending = undefined;
      throw error;
    }
  }
  private async createTracked(sessionId: string, expiresAt: number, pal: Record<string, unknown>, conversation: (palId: string) => Record<string, unknown>) {
    const r: ResourceRecord = { sessionId, expiresAt, closing: false, remoteEnded: false, palDeleted: false, cleanupAttempts: 0 };
    this.ledger.records.set(sessionId, r);
    const creationFailure = (): Exclude<StageOutcome, 'running'> => r.outcomeUnknown ? 'unresolved' : r.closing ? 'cancelled' : 'failed';
    try {
      const createdPal = await this.timings.measure(sessionId, 'pal-create', () => this.remoteCreate(r, 'pal', async () => {
        const value = await this.api.createPal(pal);
        if (!value.pal_id || typeof value.pal_id !== 'string') throw new TavusError(200, true);
        return value;
      }), creationFailure);
      r.palId = createdPal.pal_id;
      r.pending = undefined;
      await this.ledger.save();
      if (r.closing) throw new Error('resource_creation_cancelled');
      await this.timings.measure(sessionId, 'pal-verify', async () => {
        const actual = await this.api.getPal(r.palId!);
        const actualLlm = (actual.layers as { llm?: { model?: string; base_url?: string } } | undefined)?.llm;
        const desiredLlm = (pal.layers as { llm: { model: string; base_url: string } }).llm;
        if (actual.pal_id !== r.palId || actual.default_face_id !== pal.default_face_id || actual.pipeline_mode !== 'full'
          || actualLlm?.model !== desiredLlm.model || actualLlm.base_url !== desiredLlm.base_url) throw new Error('pal_effective_config_mismatch');
      }, creationFailure);
      const joined = await this.timings.measure(sessionId, 'room-create', () => this.remoteCreate(r, 'conversation', async () => {
        const value = await this.api.createConversation(conversation(r.palId!));
        if (!value.conversation_id || typeof value.conversation_id !== 'string') throw new TavusError(200, true);
        return value;
      }), creationFailure);
      r.conversationId = joined.conversation_id;
      r.pending = undefined;
      await this.ledger.save();
      if (r.closing) throw new Error('resource_creation_cancelled');
      if (!joined.meeting_token || !joined.conversation_url || new URL(joined.conversation_url).protocol !== 'https:') throw new Error('private_room_join_credentials_missing');
      return joined;
    } catch (error) {
      r.closing = true;
      await this.ledger.save();
      throw error;
    }
  }
  cleanup(sessionId: string) {
    const r = this.ledger.records.get(sessionId);
    if (!r || r.palDeleted) return Promise.resolve();
    if (r) r.closing = true; // Fence the next create before the first await.
    const existing = this.cleaning.get(sessionId);
    if (existing) return existing;
    const promise = this.timings.measure(sessionId, 'cleanup', async () => {
      if (r) await this.ledger.save();
      await this.creating.get(sessionId);
      await this.performCleanup(sessionId);
    }, () => 'unresolved', () => r.palDeleted && (!r.conversationId || r.remoteEnded) ? 'succeeded' : 'unresolved')
      .finally(() => this.cleaning.delete(sessionId));
    this.cleaning.set(sessionId, promise);
    return promise;
  }
  private async performCleanup(sessionId: string) {
    const r = this.ledger.records.get(sessionId);
    if (!r || r.palDeleted) return;
    r.closing = true;
    await this.ledger.save();
    // Unknown creation outcomes must be manually reconciled, never blindly retried.
    if (r.outcomeUnknown || r.pending) return;
    r.cleanupAttempts++;
    await this.ledger.save();
    if (r.conversationId && !r.remoteEnded) {
      const current = await this.timings.measure(sessionId, 'room-end-check', () => this.api.getConversation(r.conversationId!));
      if (current.status !== 'ended') {
        await this.timings.measure(sessionId, 'room-end-request', () => this.api.endConversation(r.conversationId!));
        const verified = await this.timings.measure(sessionId, 'room-end-verify', () => this.api.getConversation(r.conversationId!),
          () => 'failed', value => value.status === 'ended' ? 'succeeded' : 'unresolved');
        if (verified.status !== 'ended') return;
      }
      r.remoteEnded = true;
      await this.ledger.save();
    }
    if (r.palId && !r.palDeleted) {
      await this.timings.measure(sessionId, 'pal-delete', async () => {
        try { await this.api.deletePal(r.palId!); }
        catch (error) { if (!(error instanceof TavusError) || error.status !== 404) throw error; }
      });
      r.palDeleted = true;
      await this.ledger.save();
    }
    if (!r.palId) { r.palDeleted = true; r.remoteEnded = true; await this.ledger.save(); }
  }
  async sweep(now = Date.now(), force = false) {
    for (const r of this.ledger.records.values()) {
      if ((force || r.closing || r.expiresAt <= now) && !r.palDeleted && r.cleanupAttempts < 5) await this.cleanup(r.sessionId).catch(() => {});
    }
  }
  async callbackHint(id: string) {
    const r = [...this.ledger.records.values()].find(r => r.conversationId === id);
    if (!r) return false; // Untrusted IDs never cause an upstream lookup.
    // A callback cannot end a live room. GET is the authority for resource status.
    const current = await this.api.getConversation(id);
    if (current.status === 'ended') { r.remoteEnded = true; await this.cleanup(r.sessionId); }
    return true;
  }
}
