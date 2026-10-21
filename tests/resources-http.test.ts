import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { createGateway } from '../apps/gateway/server.js';
import { ResourceLedger, Resources } from '../packages/tavus/resources.js';
import { TavusClient } from '../packages/tavus/client.js';
import type { Tutor } from '../packages/tutor/runtime.js';

const operatorToken = 'synthetic-http-resource-operator-1234567890';
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
async function until(check: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!check()) { assert.ok(Date.now() < deadline, 'timed out waiting for observable state'); await new Promise(r => setTimeout(r, 5)); }
}
async function setup(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'askkai-http-resources-')); const path = join(dir, 'ledger.json');
  const ledger = new ResourceLedger(path); await ledger.load();
  const pals = new Map<string, Record<string, unknown>>(); const rooms = new Map<string, boolean>();
  const keys: string[] = []; const calls: string[] = []; const releases: (() => void)[] = [];
  let hook: (method: string, path: string) => Promise<Response | undefined> = async () => undefined;
  let allowEnd = true; let sequence = 0;
  const transport: typeof fetch = async (url, init) => {
    const u = new URL(String(url)); const method = init!.method!; const p = u.pathname;
    assert.equal(u.origin, 'https://tavusapi.com'); assert.equal(new Headers(init?.headers).get('x-api-key'), 'synthetic-only-key');
    calls.push(`${method} ${p}`); const override = await hook(method, p); if (override) return override;
    if (method === 'POST' && p === '/v2/pals') {
      const body = JSON.parse(String(init!.body)); const id = `pal-${++sequence}`; pals.set(id, body);
      keys.push(body.layers.llm.api_key); return Response.json({ pal_id: id });
    }
    if (method === 'GET' && p.startsWith('/v2/pals/')) { const id = p.split('/').at(-1)!; return Response.json({ ...pals.get(id), pal_id: id }); }
    if (method === 'POST' && p === '/v2/conversations') {
      const body = JSON.parse(String(init!.body)); assert.equal(body.require_auth, true);
      const id = `room-${++sequence}`; rooms.set(id, false);
      return Response.json({ conversation_id: id, conversation_url: `https://tavus.daily.co/${id}`, meeting_token: `PRIVATE-${id}` });
    }
    if (method === 'GET' && p.startsWith('/v2/conversations/')) return Response.json({ status: rooms.get(p.split('/').at(-1)!) ? 'ended' : 'active' });
    if (method === 'POST' && p.endsWith('/end')) { if (allowEnd) rooms.set(p.split('/').at(-2)!, true); return new Response(null, { status: 200 }); }
    if (method === 'DELETE' && p.startsWith('/v2/pals/')) return new Response(null, { status: 204 });
    throw new Error('unexpected_mock_rest_call');
  };
  const resources = new Resources(ledger, new TavusClient('synthetic-only-key', transport));
  const tutor: Tutor = { decide: async () => ({ action: 'RESPOND', reason: 'synthetic', source: 'pi' }),
    speak: async (_i, _d, signal, emit) => { signal.throwIfAborted(); await emit('离线合成开场。'); } };
  // Exercise the resource-enabled Gateway branch, with every supplier request injected locally.
  const gateway = createGateway({ operatorToken, modelMode: 'live', tutor, resources, faceId: 'approved-synthetic-face', publicUrl: 'https://gateway.example' });
  await new Promise<void>(r => gateway.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(gateway.server.address() as AddressInfo).port}`;
  t.after(async () => { releases.forEach(r => r()); allowEnd = true; await gateway.close(); await rm(dir, { recursive: true, force: true }); });
  const request = (path: string, data?: unknown, signal?: AbortSignal) => fetch(base + path, { method: data === undefined ? 'GET' : 'POST', signal,
    headers: { authorization: `Bearer ${operatorToken}`, 'content-type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const revoked = async (key: string) => {
    const response = await fetch(base + '/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', 'x-askkai-session-key': key },
      body: JSON.stringify({ model: 'ask-kai-pi', stream: true, messages: [{ role: 'user', content: '迟到请求' }] }) });
    assert.equal(response.status, 401); await response.text();
  };
  const block = (target: string) => {
    const entered = deferred(); const release = deferred(); releases.push(release.resolve);
    hook = async (method, path) => { if (`${method} ${path}` === target) { entered.resolve(); await release.promise; } return undefined; };
    return { entered: entered.promise, release: release.resolve };
  };
  return { gateway, ledger, path, calls, keys, request, revoked, block,
    setHook: (next: typeof hook) => { hook = next; }, preventEnd: () => { allowEnd = false; } };
}

test('HTTP startup disconnect fences pending PAL creation before any room is created', async t => {
  const f = await setup(t); const gate = f.block('POST /v2/pals'); const c = new AbortController();
  const start = f.request('/internal/sessions', { fixture: 'alex' }, c.signal).catch(() => undefined);
  await gate.entered; const session = f.gateway.sessions.all()[0]!; c.abort(); await start;
  await until(() => f.ledger.records.get(session.id)?.closing === true); gate.release();
  await until(() => f.ledger.records.get(session.id)?.palDeleted === true);
  assert.equal(f.calls.includes('POST /v2/conversations'), false); await f.revoked(f.keys[0]!);
});

test('HTTP end during room creation revokes credentials, cleans late room once, and never returns join credentials', async t => {
  const f = await setup(t); const gate = f.block('POST /v2/conversations');
  const starting = f.request('/internal/sessions', { fixture: 'alex' }); await gate.entered;
  const session = f.gateway.sessions.all()[0]!;
  const ending = f.request(`/internal/sessions/${session.id}/end`, {});
  await until(() => session.status === 'closing'); await f.revoked(f.keys[0]!);
  gate.release(); const [started, ended] = await Promise.all([starting, ending]);
  assert.equal(started.status, 502); assert.doesNotMatch(await started.text(), /meeting_token|PRIVATE-|conversation_url/);
  assert.equal(ended.status, 200); assert.equal((await ended.json()).status, 'closed');
  const r = f.ledger.records.get(session.id)!; assert.ok(r.remoteEnded && r.palDeleted);
  assert.equal(f.calls.filter(c => c.startsWith('DELETE ')).length, 1);
  assert.ok(f.calls.indexOf(`POST /v2/conversations/${r.conversationId}/end`) < f.calls.indexOf(`DELETE /v2/pals/${r.palId}`));
  assert.doesNotMatch(await readFile(f.path, 'utf8'), /PRIVATE-|离线合成|api_key/);
});

test('HTTP unknown room creation outcome blocks new startup without repeating creates or deleting PAL', async t => {
  const f = await setup(t);
  f.setHook(async (method, path) => { if (method === 'POST' && path === '/v2/conversations') throw new Error('PRIVATE-transport-error'); return undefined; });
  const failed = await f.request('/internal/sessions', { fixture: 'alex' }); assert.equal(failed.status, 502); await failed.text();
  const count = f.calls.length; const blocked = await f.request('/internal/sessions', { fixture: 'maya' });
  assert.equal(blocked.status, 409); assert.equal((await blocked.json()).error.code, 'resources_require_reconciliation');
  assert.equal(f.calls.length, count); assert.equal(f.calls.some(c => c.startsWith('DELETE ')), false); await f.revoked(f.keys[0]!);
});

test('HTTP failed startups retain remote resource quota until GET confirms release', async t => {
  const f = await setup(t); f.preventEnd();
  let counter = 0;
  f.setHook(async (method, path) => method === 'POST' && path === '/v2/conversations'
    ? Response.json({ conversation_id: `unusable-${++counter}`, conversation_url: 'https://tavus.daily.co/synthetic', meeting_token: '' }) : undefined);
  for (const fixture of ['alex', 'maya']) {
    const failed = await f.request('/internal/sessions', { fixture }); assert.equal(failed.status, 502); await failed.text();
  }
  assert.ok(f.gateway.sessions.all().every(s => s.status === 'failed'));
  const count = f.calls.length; const third = await f.request('/internal/sessions', { fixture: 'leo' });
  assert.equal(third.status, 429); assert.equal((await third.json()).error.code, 'resource_limit'); assert.equal(f.calls.length, count);
  assert.equal([...f.ledger.records.values()].filter(r => !r.palDeleted).length, 2);
});

test('HTTP gateway shutdown while PAL creation is pending cancels startup and releases returned resources', async t => {
  const f = await setup(t); const gate = f.block('POST /v2/pals');
  const starting = f.request('/internal/sessions', { fixture: 'alex' }).then(r => r.text()).catch(() => 'socket-closed'); await gate.entered;
  const closing = f.gateway.close(); await until(() => f.ledger.records.values().next().value?.closing === true); gate.release();
  await closing; assert.doesNotMatch(await starting, /meeting_token|PRIVATE-/);
  assert.ok([...f.ledger.records.values()].every(r => r.palDeleted)); assert.equal(f.calls.includes('POST /v2/conversations'), false);
});

test('HTTP metrics join greeting, startup and cleanup stages without exposing join credentials', async t => {
  const f = await setup(t); const response = await f.request('/internal/sessions', { fixture: 'alex' });
  assert.equal(response.status, 201); const session = await response.json();
  await (await f.request(`/internal/sessions/${session.session_id}/end`, {})).text();
  const text = await (await f.request('/internal/metrics')).text(); const report = JSON.parse(text).lifecycle;
  for (const stage of ['startup', 'greeting-decision', 'greeting-generation', 'pal-create', 'pal-verify', 'room-create', 'cleanup', 'pal-delete']) {
    assert.equal(report.stages[stage].succeeded.attempt_count, 1, stage);
  }
  assert.equal(report.cost, null); assert.equal(report.first_audible_ms, null);
  assert.doesNotMatch(text, /PRIVATE-|api_key|meeting_token|离线合成/);
  assert.ok(report.operations.every((r: { sessionId: string }) => r.sessionId === session.session_id));
});
