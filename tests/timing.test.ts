import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { RunTiming, timingSummary } from '../packages/observability/timing.js';
import { createGateway } from '../apps/gateway/server.js';
import { Sessions } from '../apps/gateway/state.js';
import type { Tutor } from '../packages/tutor/runtime.js';

test('monotonic timing retains first observations, distinguishes missing from zero, and measures cancellation settlement', () => {
  let now = 100; const t = new RunTiming(() => now);
  assert.equal(t.view().first_text_ms, null); t.mark('decision_finished'); assert.equal(t.view().decision_ms, 0);
  now = 104; t.mark('generation_started'); now = 109; t.mark('first_text_forwarded');
  now = 112; t.mark('first_text_forwarded'); t.mark('cancel_requested');
  assert.equal(t.view().cancel_to_execution_end_ms, null);
  now = 120; t.mark('generation_finished'); t.mark('execution_finished');
  assert.equal(t.view().first_text_ms, 9); assert.equal(t.view().generation_ms, 16);
  assert.equal(t.view().execution_ms, 20); assert.equal(t.view().cancel_to_execution_end_ms, 8); assert.equal(t.view().first_audible_ms, null);
});

test('timing percentiles retain status denominators and never turn missing measurements or billing into zero', () => {
  const completed = [1, 2, 20].map(duration => { let now = 0; const timing = new RunTiming(() => now); now = duration;
    timing.mark('first_text_forwarded'); timing.mark('execution_finished'); return { status: 'completed', timing }; });
  const summary = timingSummary([...completed, { status: 'failed', timing: new RunTiming(() => 0) }], 'fixture');
  const done = summary.by_status.completed! as { run_count: number; metrics: Record<string, { sample_count: number; p50: number | null; p95: number | null }> };
  assert.equal(done.run_count, 3); assert.deepEqual(done.metrics.first_text_ms, { sample_count: 3, p50: 2, p95: 20 });
  const failed = summary.by_status.failed! as typeof done;
  assert.deepEqual(failed.metrics.first_text_ms, { sample_count: 0, p50: null, p95: null });
  assert.equal(summary.source, 'synthetic-fixture'); assert.equal(summary.cost, null); assert.equal(summary.model_token_usage, null);
});

const token = 'synthetic-timing-operator-token-1234567890';
async function setup(tutor: Tutor, clock: () => number) {
  const gateway = createGateway({ operatorToken: token, modelMode: 'fixture', tutor, sessions: new Sessions(Date.now, clock) });
  await new Promise<void>(r => gateway.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(gateway.server.address() as AddressInfo).port}`;
  const op = (path: string, data?: unknown, key = token) => fetch(base + path, { method: data === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const created = await (await op('/internal/sessions', { fixture: 'alex' })).json();
  const complete = () => fetch(base + '/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', 'x-askkai-session-key': created.gateway_credential },
    body: JSON.stringify({ model: 'ask-kai-pi', stream: true, messages: [{ role: 'user', content: 'PRIVATE-INPUT' }] }) });
  return { gateway, op, complete, created };
}

test('HTTP metrics measure decision and first forwarded text separately, enforce auth and contain no transcript or key', async t => {
  let now = 0;
  const app = await setup({ decide: async () => { now += 4; return { action: 'RESPOND', reason: 'PRIVATE-REASON', source: 'pi' }; },
    speak: async (_i, _d, _s, emit) => { now += 6; await emit('PRIVATE-OUTPUT'); now += 10; } }, () => now);
  t.after(() => app.gateway.close()); await (await app.complete()).text();
  assert.equal((await app.op('/internal/metrics', undefined, 'wrong')).status, 401);
  const response = await (await app.op('/internal/metrics')).text(); const metrics = JSON.parse(response);
  assert.equal(metrics.by_status.completed.run_count, 1);
  assert.equal(metrics.by_status.completed.metrics.decision_ms.p50, 4);
  assert.equal(metrics.by_status.completed.metrics.first_text_ms.p50, 10);
  assert.equal(metrics.by_status.completed.metrics.generation_ms.p50, 16);
  assert.doesNotMatch(response, /PRIVATE-|gateway_credential|synthetic-timing-operator/);
  assert.ok(!response.includes(app.created.gateway_credential));
});

test('HTTP cancellation timing stays pending until provider execution actually settles', async t => {
  let now = 0; let release!: () => void; let entered!: () => void;
  const blocked = new Promise<void>(r => { release = r; }); const started = new Promise<void>(r => { entered = r; });
  const app = await setup({ decide: async () => { now = 10; return { action: 'RESPOND', reason: '', source: 'pi' }; },
    speak: async () => { entered(); await blocked; now = 70; } }, () => now);
  t.after(async () => { release(); await app.gateway.close(); });
  const reading = app.complete().then(r => r.text()).catch(() => 'socket-closed'); await started;
  const run = app.gateway.sessions.get(app.created.session_id).run!; now = 50;
  const stopped = await app.op(`/internal/sessions/${app.created.session_id}/stop`, { response_id: run.responseId }); await stopped.text();
  assert.equal(run.timing.view().cancel_to_execution_end_ms, null); release(); await reading;
  const deadline = Date.now() + 2000;
  while (run.timing.view().execution_ms === null) { assert.ok(Date.now() < deadline); await new Promise(r => setTimeout(r, 5)); }
  assert.equal(run.timing.view().cancel_to_execution_end_ms, 20); assert.equal(run.timing.view().first_text_ms, null);
});
