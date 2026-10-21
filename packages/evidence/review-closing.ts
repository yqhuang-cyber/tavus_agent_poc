import type { SessionSummary } from './summary.js';

interface DeliveryAck { source: 'offline-simulation' | 'adapter-ack'; status: 'finished' }
interface FinalReceipt { summaryId: string; cutoffVersion: number }
export interface ReviewClosingPort {
  speakReview(command: { summaryId: string; cutoffVersion: number; text: string }, signal: AbortSignal, generated: () => void): Promise<DeliveryAck>;
  // Atomically guard -> freeze this exact preview -> committed(), then clean up.
  // No await between that guard, freeze, and commit notification.
  finalize(summary: SessionSummary, canCommit: () => boolean, committed: () => void): Promise<FinalReceipt>;
  closeImmediately(reason: 'immediate-exit' | 'disconnect'): Promise<void>;
}
type StopReason = 'new-input' | 'immediate-exit' | 'disconnect';

// Internal offline contract, not a public callback or a Tavus playback receipt.
// A preview stays editable until finalization; generated text never means heard.
export class ReviewClosing {
  private summary: SessionSummary;
  private phase: 'idle' | 'reviewing' | 'waiting-ack' | 'finalizing' | 'finalized' | 'resumed' | 'exiting' | 'exited' | 'failed' = 'idle';
  private review: 'not-run' | 'pending' | 'acknowledged' | 'timed-out' | 'failed' | 'cancelled' | 'skipped' = 'not-run';
  private abort = new AbortController(); private committed = false; private stopReason?: StopReason;
  private stop!: (reason: StopReason) => void;
  private stopped = new Promise<StopReason>(resolve => { this.stop = resolve; });
  private execution?: Promise<ReturnType<ReviewClosing['view']>>; private exiting?: Promise<boolean>;
  constructor(summary: SessionSummary, private current: () => SessionSummary | null, private port: ReviewClosingPort,
    private deadlines = { reviewMs: 15000, finalizeMs: 10000 }) {
    if (![deadlines.reviewMs, deadlines.finalizeMs].every(n => Number.isFinite(n) && n > 0)) throw new Error('invalid_review_deadline');
    this.summary = structuredClone(summary);
  }
  view() { return { phase: this.phase, review: this.review, finalized: this.committed, presentation: 'unknown', resourceRelease: 'unverified',
    cardScope: this.phase === 'resumed' ? 'obsolete-preview' : this.committed ? 'finalized' : 'preview', card: structuredClone(this.summary) }; }
  private matches() {
    try { const s = this.current(); return !!s && s.id === this.summary.id && s.sessionId === this.summary.sessionId
      && s.cutoffVersion === this.summary.cutoffVersion && s.consentVersion === this.summary.consentVersion
      && s.contextVersion === this.summary.contextVersion && s.connectionEpoch === this.summary.connectionEpoch; }
    catch { return false; }
  }
  cancel(reason: StopReason) {
    if (this.committed || ['finalized', 'exited', 'failed'].includes(this.phase)) return;
    // Explicit exit takes precedence over an earlier request to resume chatting.
    if (this.stopReason && reason === 'new-input') return;
    this.stopReason = reason; this.abort.abort(); this.stop(reason);
    if (reason !== 'new-input' && !this.exiting) {
      this.phase = 'exiting'; this.review = 'skipped';
      this.exiting = (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([this.port.closeImmediately(reason), new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('immediate_close_timeout')), this.deadlines.finalizeMs);
          })]); this.phase = 'exited'; return true;
        }
        catch { this.phase = 'failed'; return false; }
        finally { clearTimeout(timer); }
      })();
    }
  }
  start() { return this.execution ??= this.run(); }
  private async race<T>(operation: Promise<T>, milliseconds: number) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation.then(value => ({ kind: 'result' as const, value }), () => ({ kind: 'failed' as const })),
        this.stopped.then(reason => ({ kind: 'stopped' as const, reason })),
        new Promise<{ kind: 'timeout' }>(resolve => { timer = setTimeout(() => resolve({ kind: 'timeout' }), milliseconds); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  private async finishStop() {
    if (this.stopReason && this.stopReason !== 'new-input') { await this.exiting; return this.view(); }
    this.review = 'cancelled'; this.phase = 'resumed'; return this.view();
  }
  private async run() {
    if (this.stopReason) return this.finishStop();
    if (!this.matches()) return this.finishStop();
    this.phase = 'reviewing'; this.review = 'pending';
    const delivery = await this.race(Promise.resolve().then(() => this.port.speakReview({ summaryId: this.summary.id,
      cutoffVersion: this.summary.cutoffVersion, text: this.summary.oralReview }, this.abort.signal, () => {
      if (!this.stopReason && this.phase === 'reviewing' && this.matches()) this.phase = 'waiting-ack';
    })), this.deadlines.reviewMs);
    if (this.stopReason || !this.matches()) { this.abort.abort(); return this.finishStop(); }
    if (delivery.kind === 'timeout') { this.review = 'timed-out'; this.abort.abort(); }
    else if (delivery.kind === 'result' && delivery.value?.status === 'finished'
      && ['offline-simulation', 'adapter-ack'].includes(delivery.value.source)) this.review = 'acknowledged';
    else this.review = 'failed';
    this.phase = 'finalizing';
    const canCommit = () => this.phase === 'finalizing' && !this.stopReason && !this.committed && this.matches();
    const final = await this.race(Promise.resolve().then(() => this.port.finalize(structuredClone(this.summary), canCommit, () => {
      if (!canCommit()) throw new Error('review_cutoff_invalid');
      this.committed = true;
    })), this.deadlines.finalizeMs);
    if (this.stopReason && !this.committed) return this.finishStop();
    if (final.kind === 'result' && this.committed && final.value.summaryId === this.summary.id && final.value.cutoffVersion === this.summary.cutoffVersion) this.phase = 'finalized';
    else this.phase = 'failed';
    return this.view();
  }
}
