import { randomUUID } from 'node:crypto';

export const lifecycleStages = ['startup', 'greeting-decision', 'greeting-generation', 'pal-create', 'pal-verify', 'room-create',
  'cleanup', 'room-end-check', 'room-end-request', 'room-end-verify', 'pal-delete'] as const;
export type LifecycleStage = typeof lifecycleStages[number];
export type StageOutcome = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unresolved';
interface StageRecord { operationId: string; sessionId: string; stage: LifecycleStage; outcome: StageOutcome; durationMs: number | null }
interface StageStatistics { attempt_count: number; sample_count: number; p50: number | null; p95: number | null }

// Bounded process-local observations. Never write keys, text or arbitrary errors.
export class LifecycleTimings {
  private records: StageRecord[] = []; private dropped = 0; private evicted = 0;
  constructor(private clock: () => number = () => performance.now(), private capacity = 1000) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('invalid_metric_capacity');
  }
  start(sessionId: string, stage: LifecycleStage) {
    const start = this.clock(); const r: StageRecord = { operationId: randomUUID(), sessionId, stage, outcome: 'running', durationMs: null };
    if (this.records.length >= this.capacity) {
      const old = this.records.findIndex(row => row.outcome !== 'running');
      if (old >= 0) { this.records.splice(old, 1); this.evicted++; } else this.dropped++;
    }
    if (this.records.length < this.capacity) this.records.push(r);
    let finished = false;
    return (outcome: Exclude<StageOutcome, 'running'>) => {
      if (finished) return; finished = true;
      const elapsed = this.clock() - start;
      r.durationMs = Number.isFinite(elapsed) && elapsed >= 0 ? Math.round(elapsed * 1000) / 1000 : null;
      r.outcome = outcome;
    };
  }
  async measure<T>(sessionId: string, stage: LifecycleStage, call: () => Promise<T>,
    failure: () => Exclude<StageOutcome, 'running'> = () => 'failed', success: (result: T) => Exclude<StageOutcome, 'running'> = () => 'succeeded') {
    const finish = this.start(sessionId, stage);
    try { const result = await call(); finish(success(result)); return result; }
    catch (error) { finish(failure()); throw error; }
  }
  view() {
    return { kind: 'lifecycle-execution-timing', scope: 'bounded-process-memory', unit: 'ms', capacity: this.capacity,
      dropped_active_samples: this.dropped, evicted_finished_samples: this.evicted, retained_attempts: this.records.length,
      stages: Object.fromEntries(lifecycleStages.map(stage => [stage, Object.fromEntries(
        (['running', 'succeeded', 'failed', 'cancelled', 'unresolved'] as StageOutcome[]).map(outcome => {
          const rows = this.records.filter(r => r.stage === stage && r.outcome === outcome);
          const values = rows.map(r => r.durationMs).filter((n): n is number => n !== null).sort((a, b) => a - b);
          const p = (q: number) => values.length ? values[Math.ceil(q * values.length) - 1]! : null;
          return [outcome, { attempt_count: rows.length, sample_count: values.length, p50: p(0.5), p95: p(0.95) }];
        }))])) as Record<LifecycleStage, Record<StageOutcome, StageStatistics>>,
      operations: this.records.map(r => ({ ...r })), first_audible_ms: null, cost: null };
  }
}
