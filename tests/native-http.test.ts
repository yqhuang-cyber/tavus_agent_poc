import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createHmac } from 'node:crypto';
import { createNativeServer } from '../apps/server/server.js';
import { NativeResources } from '../packages/tavus/native-resources.js';
import { PiTutor, fixturePiOptions } from '../packages/tutor/runtime.js';
import { nativeConfig, nativeToken, nativeApi } from './native-fixtures.js';

async function setup(t: { after(fn: () => unknown): void }, withSupplier = false) {
  const dir = await mkdtemp(join(tmpdir(), 'native-http-')); const supplier = nativeApi();
  const resources = withSupplier ? new NativeResources(join(dir, 'resources.json'), supplier.api, nativeConfig) : undefined;
  const app = await createNativeServer({ operatorToken: nativeToken,
    tutor: new PiTutor(fixturePiOptions()), modelMode: withSupplier ? 'live' : 'fixture', resources, configuration: nativeConfig, runtimeDirectory: dir });
  await new Promise<void>(r => app.server.listen(0, '127.0.0.1', r)); t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`; let cookie = '';
  const request = (path: string, data?: unknown, origin = base) => fetch(base + path, { method: data === undefined ? 'GET' : 'POST',
    headers: { cookie, origin, 'content-type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(
      /^\/api\/sessions\/[^/]+\//u.test(path) ? { epoch: 1, ...data as Record<string, unknown> } : data) }) });
  const login = async () => { const r = await request('/api/login', { token: nativeToken }); assert.equal(r.status, 200); cookie = r.headers.get('set-cookie')!.split(';')[0]!; };
  return { app, request, login, base, supplier };
}

test('native web entry is served, bundle has no server credential, login protects mutations and hostile origins are rejected', async t => {
  const f = await setup(t); const page = await (await f.request('/')).text(); assert.match(page, /Ask Kai/); assert.match(page, /teacher-video/);
  const bundle = await (await f.request('/app.js')).text(); assert.doesNotMatch(bundle, /synthetic-native-operator|askkai\/native-tools\/v1/);
  assert.equal((await f.request('/api/bootstrap')).status, 401);
  assert.equal((await f.request('/api/login', { token: nativeToken }, 'https://attacker.example')).status, 403);
  assert.equal((await f.request('/.env')).status, 404); await f.login();
  assert.equal((await f.request('/api/bootstrap')).status, 200);
});

test('browser API completes preparation, input/planning, cancellable same-source recap, save and record readback', async t => {
  const f = await setup(t); await f.login();
  const create = await f.request('/api/sessions', { fixture: 'alex', chineseOnly: true, saveAllowed: true }); assert.equal(create.status, 201);
  let s = await create.json(); const prefix = `/api/sessions/${s.id}`; assert.equal(s.status, 'joining');
  assert.equal((await f.request(`${prefix}/ready`, {})).status, 200);
  const turn = await f.request(`${prefix}/text`, { inputId: 'text-1', text: '我今天踢足球了。' }); assert.equal(turn.status, 200);
  const output = await turn.json(); assert.match(output.offlineReply, /离线/);
  const core = f.app.sessions.get(s.id); await core.pending?.promise;
  assert.equal(core.inputs.length, 1); assert.equal(core.teaching.language.mode, 'chinese_only');
  const first = await (await f.request(`${prefix}/prepare-close`, {})).json(); assert.equal(first.session.closing.summary.presentation, 'unknown');
  assert.equal((await f.request(`${prefix}/resume`, {})).status, 200);
  assert.equal((await f.request(`${prefix}/finish`, { closingId: first.closing.id, confirmation: 'user-confirmed' })).status, 409);
  const second = await (await f.request(`${prefix}/prepare-close`, {})).json();
  assert.equal((await f.request(`${prefix}/finish`, { closingId: second.closing.id, confirmation: 'user-confirmed' })).status, 200);
  s = await (await f.request(prefix)).json(); assert.equal(s.status, 'closed'); assert.equal(s.save.status, 'saved');
  assert.equal(s.summary.id, second.closing.summary.id); assert.equal(s.save.receipt.summaryId, s.summary.id);
  const originalReview = core.summary!.oralReview; core.summary!.oralReview = 'UNSAVED-VIEW-MUTATION';
  const records = await (await f.request('/api/records')).json(); assert.equal(records.records.length, 1);
  assert.equal(records.records[0].summary.oralReview, originalReview); core.summary!.oralReview = originalReview;
  const oldId = s.save.receipt.id; await f.request(`${prefix}/save`, {}); assert.equal(f.app.sessions.get(s.id).receipt!.id, oldId);
});

test('native API isolates operator owners, rejects wrong-room events, and immediate exit does not wait for model completion', async t => {
  const f = await setup(t); await f.login();
  const s = await (await f.request('/api/sessions', { fixture: 'maya', chineseOnly: false, saveAllowed: false })).json();
  const prefix = `/api/sessions/${s.id}`; await f.request(`${prefix}/ready`, {});
  assert.equal((await f.request(`${prefix}/event`, { epoch: 1, event: { conversation_id: 'other', message_type: 'conversation' } })).status, 409);
  await f.request(`${prefix}/text`, { inputId: 'one', text: '你好' });
  const ended = await (await f.request(`${prefix}/exit`, {})).json(); assert.ok(['closing', 'closed'].includes(ended.status));
  assert.equal((await f.request(`${prefix}/text`, { inputId: 'two', text: '旧输入' })).status, 409);
  await f.login(); assert.equal((await f.request(prefix)).status, 404);
});

test('explicit reconnect advances epoch and fences old text, old exits and delayed control receipts', async t => {
  const f = await setup(t); await f.login();
  const s = await (await f.request('/api/sessions', { fixture: 'leo', chineseOnly: false, saveAllowed: false })).json();
  const prefix = `/api/sessions/${s.id}`; await f.request(`${prefix}/ready`, {});
  const rejoined = await (await f.request(`${prefix}/reconnect`, {})).json(); assert.equal(rejoined.epoch, 2);
  assert.equal((await f.request(`${prefix}/exit`, {})).status, 409);
  assert.equal((await f.request(`${prefix}/text`, { inputId: 'old', text: '旧连接' })).status, 409);
  assert.equal((await f.request(`${prefix}/context-sent`, { version: rejoined.version })).status, 409);
  assert.equal((await f.request(`${prefix}/ready`, { epoch: 2 })).status, 200);
  assert.equal((await f.request(`${prefix}/text`, { epoch: 2, inputId: 'new', text: '你好' })).status, 200);
});

test('native HTTP lifecycle connects supplier room, signed closing tool, same-source card and verified remote cleanup', async t => {
  const f = await setup(t, true); await f.login();
  const s = await (await f.request('/api/sessions', { fixture: 'alex', chineseOnly: false, saveAllowed: true })).json();
  const prefix = `/api/sessions/${s.id}`;
  const info = await (await f.request(`${prefix}/join`)).json(); assert.equal(info.conversation_id, 'room-1'); assert.ok(info.meeting_token);
  await f.request(`${prefix}/ready`, {});
  const event = { message_type: 'conversation', event_type: 'conversation.utterance', conversation_id: 'room-1',
    inference_id: 'user-1', seq: 1, properties: { role: 'user', speech: '我昨天踢足球了。' } };
  assert.equal((await f.request(`${prefix}/event`, { event })).status, 200); await f.app.sessions.get(s.id).pending?.promise;
  const preview = await (await f.request(`${prefix}/prepare-close`, {})).json();
  const raw = JSON.stringify({ name: nativeConfig.names.closing, arguments: JSON.stringify({ ending_request: '结束' }),
    tool_call_id: 'close-one', conversation_id: 'room-1', inference_id: 'pal-close' });
  const signature = createHmac('sha256', nativeConfig.toolSecret).update(raw).digest('hex');
  const tool = await fetch(f.base + '/hooks/tavus/tools', { method: 'POST', headers: { 'content-type': 'application/json', 'x-tavus-signature': signature }, body: raw });
  assert.equal(tool.status, 200); const result = await tool.json(); assert.equal(result.summary_hash, preview.closing.summary.id);
  await f.request(`${prefix}/finish`, { closingId: preview.closing.id, confirmation: 'user-confirmed' });
  // Await the idempotent shutdown path to observe actual injected GET-ended verification.
  await f.app.close(); const final = f.app.sessions.get(s.id);
  assert.equal(final.cleanup, 'remote-ended-confirmed'); assert.equal(final.status, 'closed');
  assert.equal(final.receipt!.summaryId, preview.closing.summary.id); assert.equal(f.supplier.calls.filter(c => c === 'pal').length, 1);
  assert.ok(f.supplier.calls.includes('end:room-1'));
});
