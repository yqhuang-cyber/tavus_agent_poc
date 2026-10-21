export const timingMarks = ['decision_finished', 'generation_started', 'first_text_forwarded', 'generation_finished', 'cancel_requested', 'execution_finished'] as const;
type TimingMark = typeof timingMarks[number];
const rounded = (n: number) => Math.round(n * 1000) / 1000;

// Process-local monotonic elapsed time, without prompts, responses or credentials.
export class RunTiming {
  private origin: number;
  private marks: Partial<Record<TimingMark, number>> = {};
  constructor(private clock: () => number = () => performance.now()) { this.origin = clock(); }
  mark(name: TimingMark) {
    if (this.marks[name] !== undefined) return;
    const elapsed = this.clock() - this.origin;
    if (Number.isFinite(elapsed) && elapsed >= 0) this.marks[name] = elapsed;
  }
  view() {
    const m = this.marks;
    const difference = (end: TimingMark, start?: TimingMark) => {
      const a = m[end]; const b = start ? m[start] : 0;
      return a === undefined || b === undefined || a < b ? null : rounded(a - b);
    };
    return { clock: 'monotonic', unit: 'ms',
      marks: Object.fromEntries(Object.entries(m).map(([key, value]) => [key, rounded(value)])),
      decision_ms: difference('decision_finished'), generation_ms: difference('generation_finished', 'generation_started'),
      first_text_ms: difference('first_text_forwarded'), execution_ms: difference('execution_finished'),
      cancel_to_execution_end_ms: difference('execution_finished', 'cancel_requested'), first_audible_ms: null };
  }
}

type TimedRun = { status: string; timing: RunTiming };
const metricNames = ['decision_ms', 'generation_ms', 'first_text_ms', 'execution_ms', 'cancel_to_execution_end_ms'] as const;
function distribution(runs: TimedRun[]) {
  return Object.fromEntries(metricNames.map(name => {
    const values = runs.map(r => r.timing.view()[name]).filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
    const percentile = (q: number) => values.length ? values[Math.max(0, Math.ceil(q * values.length) - 1)]! : null;
    return [name, { sample_count: values.length, p50: percentile(0.5), p95: percentile(0.95) }];
  }));
}
export function timingSummary(runs: TimedRun[], mode: 'fixture' | 'live') {
  return { kind: 'gateway-execution-timing', source: mode === 'fixture' ? 'synthetic-fixture' : 'live-configured',
    scope: 'retained-session-runs', unit: 'ms', run_count: runs.length,
    by_status: Object.fromEntries(['running', 'completed', 'partial', 'cancelled', 'failed'].map(status => {
      const subset = runs.filter(r => r.status === status);
      return [status, { run_count: subset.length, metrics: distribution(subset) }];
    })), first_audible_ms: null, model_token_usage: null, cost: null, supplier_media_measurement: 'not-run' };
}
