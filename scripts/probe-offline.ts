import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { writeOfflineReport } from '../packages/verification/reports.js';
import { createGateway } from '../apps/gateway/server.js';
import { PiTutor, fixturePiOptions } from '../packages/tutor/runtime.js';
import { readSse } from '../packages/tavus/sse.js';

const operatorToken = randomBytes(32).toString('base64url');
const gateway = createGateway({ operatorToken, modelMode: 'fixture', tutor: new PiTutor(fixturePiOptions()) });
await new Promise<void>(resolve => gateway.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${(gateway.server.address() as AddressInfo).port}`;
const operator = (path: string, data?: unknown) => fetch(base + path, { method: data ? 'POST' : 'GET',
  headers: { authorization: `Bearer ${operatorToken}`, 'content-type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) });
try {
  const fixtures = ['alex', 'maya'];
  let completed = 0;
  await Promise.all(fixtures.map(async fixture => {
    const created = await operator('/internal/sessions', { fixture }); assert.equal(created.status, 201);
    const session = await created.json() as { session_id: string; gateway_credential: string };
    const messages: { role: string; content: string }[] = [];
    for (let turn = 0; turn < 10; turn++) {
      messages.push({ role: 'user', content: '你好，我今天想聊天。' }); // Legitimate repeated text, distinct positions.
      const response = await fetch(base + '/v1/chat/completions', { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-askkai-session-key': session.gateway_credential },
        body: JSON.stringify({ model: 'ask-kai-pi', stream: true, messages }) });
      assert.equal(response.status, 200); assert.ok(response.body);
      let text = ''; let done = false; let stopped = false;
      for await (const data of readSse(response.body)) {
        if (data === '[DONE]') { done = true; continue; }
        const frame = JSON.parse(data); const choice = frame.choices[0];
        text += choice.delta.content ?? ''; if (choice.finish_reason === 'stop') stopped = true;
      }
      assert.ok(done && stopped); assert.match(text, fixture === 'alex' ? /Alex/ : /Maya/);
      assert.doesNotMatch(text, /reason|MODE:|"action"/);
      messages.push({ role: 'assistant', content: text }); completed++;
    }
    const closed = await operator(`/internal/sessions/${session.session_id}/end`, {}); assert.equal(closed.status, 200);
    const diagnostic = await (await operator(`/internal/sessions/${session.session_id}`)).json() as { runs: { status: string; decision_source: string }[] };
    assert.equal(diagnostic.runs.length, 10); assert.ok(diagnostic.runs.every(r => r.status === 'completed' && r.decision_source === 'pi'));
  }));
  const timing = await (await operator('/internal/metrics')).json();
  assert.equal(timing.source, 'synthetic-fixture'); assert.equal(timing.by_status.completed.run_count, completed);
  for (const name of ['decision_ms', 'first_text_ms', 'generation_ms', 'execution_ms']) assert.equal(timing.by_status.completed.metrics[name].sample_count, completed);
  assert.equal(timing.first_audible_ms, null);
  const report = { timestamp: new Date().toISOString(), kind: 'offline-synthetic', pi_version: '1.2.0',
    model: 'synthetic-offline', tavus_requests: 0, sessions: fixtures.length, completed_turns: completed, timing,
    checks: { pi_decision_then_speech: 'passed', sse: 'passed', two_session_isolation: 'passed', repeated_input: 'passed', close: 'passed' },
    real_supplier: 'not-run', real_media: 'not-run', tavus_gemma_4: 'endpoint-unconfirmed' };
  await writeOfflineReport('offline-probe.json', report);
  console.log(JSON.stringify(report, null, 2));
} finally { await gateway.close(); }
