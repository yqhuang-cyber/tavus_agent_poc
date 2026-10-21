import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { PreparationTickets } from '../packages/business/preparation.js';
import { getMockContext } from '../packages/business/context.js';
import { createGateway } from '../apps/gateway/server.js';
import { PiTutor, fixturePiOptions } from '../packages/tutor/runtime.js';

test('preparation binds a cloned synthetic profile to its trusted actor and has no session/media side effects', () => {
  const tickets = new PreparationTickets(); const context = getMockContext('alex', true); context.preferences.chineseOnly = true;
  const prepared = tickets.issue(context, 'actor-a'); assert.equal(prepared.resources_created, false); assert.equal(prepared.media_ready, false);
  context.preferences.chineseOnly = false; context.saveAllowed = false;
  assert.throws(() => tickets.redeem(prepared.preparation_ticket, 'actor-b'), /actor_mismatch/);
  const accepted = tickets.redeem(prepared.preparation_ticket, 'actor-a');
  assert.equal(accepted.preferences.chineseOnly, true); assert.equal(accepted.saveAllowed, true);
  assert.throws(() => tickets.redeem(prepared.preparation_ticket, 'actor-a'), /already_used/);
});

test('expired/unknown tickets are rejected, capacity recovers, and cleared tickets cannot be replayed', () => {
  let now = 0; const tickets = new PreparationTickets(() => now);
  const first = tickets.issue(getMockContext('alex'), 'actor');
  for (let i = 0; i < 15; i++) tickets.issue(getMockContext('maya'), 'actor');
  assert.throws(() => tickets.issue(getMockContext('leo'), 'actor'), /preparation_limit/);
  now = 60000; assert.throws(() => tickets.redeem(first.preparation_ticket, 'actor'), /expired/);
  const next = tickets.issue(getMockContext('leo'), 'actor');
  assert.throws(() => tickets.redeem('unknown', 'actor'), /invalid_preparation/);
  tickets.clear(); assert.throws(() => tickets.redeem(next.preparation_ticket, 'actor'), /invalid_preparation/);
});

test('concurrent redemption has exactly one winner before asynchronous resource work', async () => {
  const tickets = new PreparationTickets(); const prepared = tickets.issue(getMockContext('nina'), 'actor');
  const results = await Promise.allSettled([0, 1].map(() => Promise.resolve().then(() => tickets.redeem(prepared.preparation_ticket, 'actor'))));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.filter(r => r.status === 'rejected').length, 1);
});

test('HTTP preparation consumes a bound ticket, rejects preference substitution and preserves a ticket at session capacity', async t => {
  const token = 'preparation-operator-test-0123456789abcdef';
  const app = createGateway({ operatorToken: token, modelMode: 'fixture', tutor: new PiTutor(fixturePiOptions()) }); t.after(() => app.close());
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const request = (path: string, data: unknown, key = token) => fetch(base + path, { method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(data) });
  assert.equal((await request('/internal/preparations', { fixture: 'alex' }, 'wrong')).status, 401);
  const prepared = await (await request('/internal/preparations', { fixture: 'alex', chinese_only: true, mock_save_allowed: true })).json();
  assert.equal(app.sessions.all().length, 0); assert.equal(prepared.status, 'prepared'); assert.equal(prepared.media_ready, false);
  assert.equal((await request('/internal/sessions', { preparation_ticket: prepared.preparation_ticket, fixture: 'nina' })).status, 400);
  const response = await request('/internal/sessions', { preparation_ticket: prepared.preparation_ticket }); assert.equal(response.status, 201);
  const started = await response.json(); assert.equal(started.teaching.language, 'chinese_only'); assert.equal(app.sessions.get(started.session_id).context.fixtureId, 'alex');
  assert.equal(app.sessions.get(started.session_id).context.saveAllowed, true);
  assert.equal((await request('/internal/sessions', { preparation_ticket: prepared.preparation_ticket })).status, 409);
  await request('/internal/sessions', { fixture: 'maya' });
  const queued = await (await request('/internal/preparations', { fixture: 'leo' })).json();
  assert.equal((await request('/internal/sessions', { preparation_ticket: queued.preparation_ticket })).status, 429);
  await request(`/internal/sessions/${started.session_id}/end`, {});
  assert.equal((await request('/internal/sessions', { preparation_ticket: queued.preparation_ticket })).status, 201);
});

test('Mock preparations cannot authorize live-mode identity or media', async t => {
  const token = 'live-mode-negative-test-0123456789abcdef';
  const app = createGateway({ operatorToken: token, modelMode: 'live', tutor: new PiTutor(fixturePiOptions()) }); t.after(() => app.close());
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const response = await fetch(base + '/internal/preparations', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ fixture: 'alex' }) });
  assert.equal(response.status, 409); assert.equal(app.sessions.all().length, 0);
});
