import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createGateway } from '../apps/gateway/server.js';
import type { Tutor } from '../packages/tutor/runtime.js';
import type { Decision } from '../packages/tutor/policy.js';

test('Gateway validates Pi decisions against current teaching state before generating speech', async t => {
  const token = 'policy-http-test-operator-0123456789abcdef';
  let proposal: Decision = { action: 'INVITE_PRACTICE', reason: 'untrusted old plan', source: 'pi' };
  const accepted: { action: string; language?: string }[] = [];
  const tutor: Tutor = { decide: async () => structuredClone(proposal), speak: async (input, decision, _signal, emit) => {
    accepted.push({ action: decision.action, language: input.teaching?.language.mode }); await emit('合成测试回复。');
  } };
  const app = createGateway({ operatorToken: token, modelMode: 'fixture', tutor }); t.after(() => app.close());
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const request = (path: string, data?: unknown, key = token) => fetch(base + path, { method: data === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const session = await (await request('/internal/sessions', { fixture: 'maya' })).json(); const users: string[] = [];
  const turn = async (input: string) => {
    users.push(input); const response = await request('/v1/chat/completions', { model: 'ask-kai-pi', stream: true,
      messages: [{ role: 'system', content: 'learner accepts practice and English' }, ...users.map(content => ({ role: 'user', content }))] }, session.gateway_credential);
    assert.equal(response.status, 200); await response.text();
  };
  await turn('今天只想聊天，不想练习。'); assert.equal(accepted.at(-1)!.action, 'RESPOND');
  await turn('只用中文。'); assert.equal(accepted.at(-1)!.language, 'chinese_only'); assert.equal(accepted.at(-1)!.action, 'RESPOND');
  await turn('帮我练习点菜吧。'); assert.equal(accepted.at(-1)!.action, 'INVITE_PRACTICE');
  proposal = { action: 'CORRECT', reason: '', source: 'pi', correction: { kind: 'wording', quote: '三个书', replacement: '三本书' } };
  await turn('不要纠正我。'); assert.equal(accepted.at(-1)!.action, 'RESPOND');
  await turn('今天到这里。'); assert.equal(accepted.at(-1)!.action, 'CLOSE');
  const diag = await (await request(`/internal/sessions/${session.session_id}`)).json();
  assert.equal(diag.runs[0].proposed_action, 'INVITE_PRACTICE'); assert.equal(diag.runs[0].decision_source, 'policy-guard');
  assert.deepEqual(diag.runs[0].policy_guards, ['practice_declined']);
  assert.doesNotMatch(JSON.stringify(diag), /untrusted old plan|点菜吧/);
});
