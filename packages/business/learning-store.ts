import { createHash, randomUUID } from 'node:crypto';
import type { SessionSummary } from '../evidence/summary.js';

export interface SaveReceipt {
  id: string; sessionId: string; summaryId: string; consentVersion: number;
  idempotencyKey: string; mode: 'mock-memory'; status: 'saved'; savedAt: string;
}
export interface SaveRequest {
  summary: SessionSummary; idempotencyKey: string; canCommit: () => boolean;
}
export interface LearningStore { save(request: SaveRequest): Promise<SaveReceipt> }

export class MockLearningStore implements LearningStore {
  private entries = new Map<string, { fingerprint: string; summary: SessionSummary; receipt: SaveReceipt }>();
  constructor(private hooks: { beforeCommit?: () => Promise<void>; afterCommit?: () => Promise<void> } = {}) {}
  async save(request: SaveRequest) {
    // Snapshot caller data before any await; callers cannot mutate the pending write.
    const summary = structuredClone(request.summary);
    const fingerprint = createHash('sha256').update(JSON.stringify(summary)).digest('hex');
    if (!request.canCommit()) throw new Error('save_not_authorized');
    await this.hooks.beforeCommit?.();
    if (!request.canCommit()) throw new Error('save_not_authorized');
    const previous = this.entries.get(request.idempotencyKey);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new Error('idempotency_conflict');
      return structuredClone(previous.receipt);
    }
    const receipt: SaveReceipt = { id: randomUUID(), sessionId: summary.sessionId, summaryId: summary.id,
      consentVersion: summary.consentVersion, idempotencyKey: request.idempotencyKey,
      mode: 'mock-memory', status: 'saved', savedAt: new Date().toISOString() };
    // Consent check and the memory write are synchronous: no yield in between.
    this.entries.set(request.idempotencyKey, { fingerprint, summary, receipt });
    await this.hooks.afterCommit?.(); // Fault injection: a lost acknowledgement can be retried by the same key.
    return structuredClone(receipt);
  }
  get size() { return this.entries.size; }
  read(receiptId: string) {
    const entry = [...this.entries.values()].find(e => e.receipt.id === receiptId);
    return entry ? structuredClone({ summary: entry.summary, receipt: entry.receipt }) : undefined;
  }
}
