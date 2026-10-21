import { createHash } from 'node:crypto';
import { MockLearningStore, type LearningStore, type SaveReceipt } from '../../packages/business/learning-store.js';
import { buildSummary, type SessionSummary } from '../../packages/evidence/summary.js';
import type { CloseReason } from '../../packages/evidence/journal.js';
import { HttpError, type Session } from './state.js';

interface SummaryEntry {
  summary: SessionSummary; status: 'not_requested' | 'pending' | 'saved' | 'denied' | 'failed';
  receipt?: SaveReceipt; pending?: Promise<void>;
}
export class Summaries {
  private entries = new Map<string, SummaryEntry>();
  constructor(private store: LearningStore = new MockLearningStore()) {}
  preview(s: Session) {
    const input = s.evidence.inspect();
    const complete = input.inputs.length > 0 && input.inputs.length === s.users.length && input.inputs.every(i => i.modality === 'text')
      && s.runs.every(r => r.status === 'completed');
    const summary = buildSummary(s.evidence.preview({ sessionId: s.id, cutoffVersion: s.stateVersion, consentVersion: s.context.consentVersion,
      contextVersion: s.context.version, connectionEpoch: s.connectionEpoch }, 'user_end', complete));
    if (summary.cutoffVersion !== s.stateVersion || summary.consentVersion !== s.context.consentVersion
      || summary.contextVersion !== s.context.version || summary.connectionEpoch !== s.connectionEpoch) throw new HttpError(409, 'stale_summary_preview');
    return summary;
  }
  freeze(s: Session, reason: CloseReason) {
    const existing = this.entries.get(s.id); if (existing) return this.view(s);
    const input = s.evidence.inspect();
    const complete = reason === 'user_end' && input.inputs.length > 0 && input.inputs.length === s.users.length && input.inputs.every(i => i.modality === 'text')
      && s.runs.every(r => r.status === 'completed');
    const snapshot = s.evidence.freeze({ sessionId: s.id, cutoffVersion: s.stateVersion,
      consentVersion: s.context.consentVersion, contextVersion: s.context.version, connectionEpoch: s.connectionEpoch }, reason, complete);
    this.entries.set(s.id, { summary: buildSummary(snapshot), status: 'not_requested' });
    return this.view(s);
  }
  private entry(s: Session) {
    const entry = this.entries.get(s.id);
    if (!entry) throw new HttpError(409, 'summary_not_finalized');
    return entry;
  }
  view(s: Session) {
    const e = this.entry(s);
    const status = e.status;
    const currentBinding = s.context.saveAllowed && e.summary.consentVersion === s.context.consentVersion
      && e.summary.contextVersion === s.context.version && e.summary.cutoffVersion === s.stateVersion
      && e.summary.connectionEpoch === s.connectionEpoch && !s.retired;
    return structuredClone({ ...e.summary, save: { status, mode: 'mock-memory',
      current_binding_valid: currentBinding,
      label: status === 'saved' ? `已保存（本地模拟，进程重启即丢失${currentBinding ? '' : '；当前许可或版本已变化'}）` : status === 'pending' ? '保存处理中（本地模拟）'
        : status === 'denied' ? '当前许可或版本不允许继续保存；此前结果以回执为准' : status === 'failed' ? '未收到保存回执，可重试' : '未保存',
      ...(status === 'saved' && e.receipt ? { receipt: e.receipt } : {}) } });
  }
  requestSave(s: Session, summaryId: string, consentVersion: number) {
    const e = this.entry(s);
    if (e.summary.id !== summaryId || consentVersion !== s.context.consentVersion || consentVersion !== e.summary.consentVersion) throw new HttpError(409, 'stale_summary_or_consent');
    if (e.pending) return this.view(s);
    if (e.status === 'saved') return this.view(s);
    const canCommit = () => s.context.saveAllowed && s.context.consentVersion === consentVersion
      && s.context.version === e.summary.contextVersion && s.stateVersion === e.summary.cutoffVersion
      && s.connectionEpoch === e.summary.connectionEpoch && !s.retired && Date.now() <= s.expiresAt + 60000 && ['closing', 'closed'].includes(s.status);
    if (!canCommit()) { e.status = 'denied'; return this.view(s); }
    e.status = 'pending';
    const idempotencyKey = createHash('sha256').update(`${s.id}:${summaryId}:${consentVersion}`).digest('hex');
    e.pending = (async () => {
      try {
        const receipt = await Promise.resolve().then(() => this.store.save({ summary: structuredClone(e.summary), idempotencyKey, canCommit }));
        if (!canCommit()) { e.status = 'denied'; return; }
        if (receipt.status !== 'saved' || receipt.mode !== 'mock-memory' || !receipt.id || !receipt.savedAt
          || receipt.sessionId !== s.id || receipt.summaryId !== summaryId || receipt.consentVersion !== consentVersion
          || receipt.idempotencyKey !== idempotencyKey) throw new Error('invalid_save_receipt');
        e.receipt = structuredClone(receipt); e.status = 'saved';
      } catch { e.status = canCommit() ? 'failed' : 'denied'; }
      finally { e.pending = undefined; }
    })();
    return this.view(s);
  }
  async wait(s: Session) { await this.entry(s).pending; return this.view(s); }
  retain(sessionIds: Set<string>) {
    for (const [id, entry] of this.entries) if (!sessionIds.has(id) && !entry.pending) this.entries.delete(id);
  }
}
