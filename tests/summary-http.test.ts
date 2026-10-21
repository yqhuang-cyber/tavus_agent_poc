import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createGateway } from '../apps/gateway/server.js';
import { PiTutor, fixturePiOptions } from '../packages/tutor/runtime.js';

test('operator-only evidence -> close -> same-source oral/card summary -> actual Mock save receipt', async t => {
  const token = 'summary-test-operator-0123456789abcdef';
  const app = createGateway({ operatorToken: token, modelMode: 'fixture', tutor: new PiTutor(fixturePiOptions()) }); t.after(() => app.close());
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const request = (path: string, data?: unknown, credential = token) => fetch(base + path, { method: data === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const started = await request('/internal/sessions', { fixture: 'alex', mock_save_allowed: true });
  const session = await started.json(); const prefix = `/internal/sessions/${session.session_id}`;
  assert.equal((await request(`${prefix}/summary`)).status, 409);
  const response = await request('/v1/chat/completions', { model: 'ask-kai-pi', stream: true, input_modality: 'text',
    messages: [{ role: 'user', content: '我昨天去踢足球了。' }] }, session.gateway_credential);
  assert.equal(response.status, 200); await response.text();
  const evidence = await (await request(`${prefix}/evidence`)).json(); const source = evidence.inputs[0];
  const diagnostic = await (await request(prefix)).json();
  assert.equal((await request(`${prefix}/evidence`, undefined, session.gateway_credential)).status, 401);
  const selection = { kind: 'attempt', evidence_id: source.id, quote: '踢足球', expected_state_version: diagnostic.state_version, expected_consent_version: 1 };
  assert.equal((await request(`${prefix}/evidence`, { ...selection, expected_state_version: 0 })).status, 409);
  assert.equal((await request(`${prefix}/evidence`, { ...selection, mastery: 'mastered' })).status, 400);
  assert.equal((await request(`${prefix}/evidence`, selection)).status, 201);
  assert.equal((await request(`${prefix}/end`, { save: true, expected_consent_version: 0 })).status, 409);
  assert.equal(app.sessions.get(session.session_id).status, 'active');
  const ended = await request(`${prefix}/end`, { save: true, expected_consent_version: 1 }); assert.equal(ended.status, 200);
  const summary = await app.summaries.wait(app.sessions.get(session.session_id));
  assert.equal(summary.save.status, 'saved'); assert.match(summary.save.label, /本地模拟/);
  assert.equal(summary.attempts[0]!.quote, '踢足球'); assert.equal(summary.attempts[0]!.evidenceId, source.id);
  assert.match(summary.oralReview, /我昨天去踢足球了/); assert.equal(summary.cutoffVersion, diagnostic.state_version);
  const again = await (await request(`${prefix}/end`, {})).json(); assert.equal(again.summary.id, summary.id);
  const receiptId = summary.save.receipt!.id;
  const retry = await (await request(`${prefix}/summary/save`, { summary_id: summary.id, expected_consent_version: 1 })).json();
  assert.equal(retry.save.receipt.id, receiptId);
  assert.equal((await request(`${prefix}/evidence`, selection)).status, 409);
});
