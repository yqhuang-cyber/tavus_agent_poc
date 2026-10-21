import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { TavusClient, TavusError, conversationConfig, palConfig, type TavusApi } from '../packages/tavus/client.js';
import { ResourceLedger, Resources } from '../packages/tavus/resources.js';

function fakeApi() {
  const calls: string[] = []; let config: Record<string, unknown> = {}; let ended = false;
  const api: TavusApi = {
    createPal: async body => { calls.push('createPal'); config = body; return { pal_id: 'pal-1' }; },
    getPal: async () => { calls.push('getPal'); return { ...config, pal_id: 'pal-1' }; },
    createConversation: async body => { calls.push('createConversation'); assert.equal(body.require_auth, true);
      assert.equal(body.max_participants, 2); assert.equal((body.properties as Record<string, unknown>).enable_recording, false);
      return { conversation_id: 'room-1', conversation_url: 'https://tavus.daily.co/room-1', meeting_token: 'private-room-token' }; },
    getConversation: async () => { calls.push('getConversation'); return { status: ended ? 'ended' : 'active' }; },
    endConversation: async () => { calls.push('endConversation'); ended = true; },
    deletePal: async () => { calls.push('deletePal'); },
  };
  return { api, calls, finish: () => { ended = true; } };
}
async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'askkai-resources-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'resources.json'); const ledger = new ResourceLedger(path); await ledger.load();
  const f = fakeApi(); const resources = new Resources(ledger, f.api);
  const create = () => resources.create('s1', Date.now() + 900000,
    palConfig('s1', 'face-approved', 'voice-approved', 'https://gateway.example', 'session-secret'),
    id => conversationConfig('s1', id, 'face-approved', 'https://gateway.example', '你好'));
  return { ...f, ledger, resources, create, path };
}

test('private room lifecycle persists IDs, verifies end, deletes PAL once, never secrets', async t => {
  const f = await setup(t); const joined = await f.create(); assert.equal(joined.meeting_token, 'private-room-token');
  const data = await readFile(f.path, 'utf8'); assert.match(data, /pal-1/); assert.doesNotMatch(data, /session-secret|private-room-token|你好/);
  await Promise.all([f.resources.cleanup('s1'), f.resources.cleanup('s1')]); await f.resources.cleanup('s1');
  assert.equal(f.ledger.records.get('s1')!.remoteEnded, true); assert.equal(f.ledger.records.get('s1')!.palDeleted, true);
  assert.deepEqual(f.calls.slice(-4), ['getConversation', 'endConversation', 'getConversation', 'deletePal']);
  assert.equal(f.calls.filter(c => c === 'deletePal').length, 1);
});

test('definite conversation create failure cleans PAL; unknown response never repeats create or deletes its PAL', async t => {
  const f = await setup(t);
  f.api.createConversation = async () => { throw new TavusError(400, false); };
  await assert.rejects(f.create()); assert.equal(f.ledger.records.get('s1')!.palDeleted, true);
  const g = await setup(t);
  g.api.createConversation = async () => { throw new TavusError(undefined, true); };
  await assert.rejects(g.create()); await g.resources.sweep(Date.now(), true);
  assert.equal(g.ledger.records.get('s1')!.outcomeUnknown, true); assert.equal(g.calls.includes('deletePal'), false);
  await assert.rejects(g.create(), /already_attempted/); assert.equal(g.calls.filter(c => c === 'createPal').length, 1);
});

test('invalid join credential still preserves room ID and releases resources', async t => {
  const f = await setup(t); const original = f.api.createConversation;
  f.api.createConversation = async body => ({ ...await original(body), meeting_token: '' });
  await assert.rejects(f.create(), /credentials_missing/);
  assert.equal(f.ledger.records.get('s1')!.conversationId, 'room-1'); assert.ok(f.ledger.records.get('s1')!.remoteEnded);
});

test('end 200 alone is not release evidence; cleanup retries after confirmed status', async t => {
  const f = await setup(t); await f.create();
  f.api.endConversation = async () => { f.calls.push('endConversation'); };
  await f.resources.cleanup('s1'); assert.equal(f.calls.includes('deletePal'), false); assert.equal(f.ledger.records.get('s1')!.remoteEnded, false);
  f.finish(); await f.resources.sweep(); assert.equal(f.ledger.records.get('s1')!.palDeleted, true);
});

test('restart preserves pending create as outcome unknown and callback cannot force-end active room', async t => {
  const f = await setup(t); await f.create(); const before = f.calls.length;
  assert.equal(await f.resources.callbackHint('unknown'), false); assert.equal(f.calls.length, before);
  await f.resources.callbackHint('room-1'); assert.equal(f.calls.includes('endConversation'), false);
  f.ledger.records.get('s1')!.pending = 'conversation'; await f.ledger.save();
  const restart = new ResourceLedger(f.path); await restart.load(); assert.equal(restart.records.get('s1')!.outcomeUnknown, true);
});

test('Tavus REST accepts no-body 200/204, escapes IDs and does not retry unknown paid creates', async () => {
  const requests: { url: string; method: string }[] = [];
  const transport: typeof fetch = async (url, init) => {
    requests.push({ url: String(url), method: init!.method! });
    assert.equal((init!.headers as Record<string, string>)['x-api-key'], 'server-key');
    return new Response(null, { status: init!.method === 'DELETE' ? 204 : 200 });
  };
  const client = new TavusClient('server-key', transport);
  await client.endConversation('a/b'); await client.deletePal('p'); assert.match(requests[0]!.url, /a%2Fb\/end$/);
  let attempts = 0;
  const unknown = new TavusClient('server-key', async () => { attempts++; throw new Error('secret'); });
  await assert.rejects(unknown.createPal({}), e => e instanceof TavusError && e.outcomeUnknown && !e.message.includes('secret'));
  assert.equal(attempts, 1);
});

test('close during PAL creation or verification never starts a room and never deletes in-flight resources', async t => {
  for (const stage of ['createPal', 'getPal'] as const) {
    const f = await setup(t); let enter!: () => void; let release!: () => void;
    const started = new Promise<void>(r => { enter = r; }); const blocked = new Promise<void>(r => { release = r; });
    const original = f.api[stage];
    if (stage === 'createPal') f.api.createPal = async body => { enter(); await blocked; return (original as TavusApi['createPal'])(body); };
    else f.api.getPal = async id => { enter(); await blocked; return (original as TavusApi['getPal'])(id); };
    const creation = f.create(); const rejected = assert.rejects(creation, /creation_cancelled/); await started;
    const closing = f.resources.cleanup('s1'); assert.equal(f.calls.includes('deletePal'), false);
    release(); await Promise.all([rejected, closing]);
    assert.equal(f.calls.includes('createConversation'), false); assert.equal(f.calls.filter(c => c === 'deletePal').length, 1);
    assert.equal(f.ledger.records.get('s1')!.palDeleted, true);
  }
});

test('close during room creation waits for the late ID, then ends the room before deleting its PAL', async t => {
  const f = await setup(t); let enter!: () => void; let release!: () => void;
  const started = new Promise<void>(r => { enter = r; }); const blocked = new Promise<void>(r => { release = r; });
  const original = f.api.createConversation;
  f.api.createConversation = async body => { enter(); await blocked; return original(body); };
  const creation = f.create(); const rejected = assert.rejects(creation, /creation_cancelled/); await started;
  const closings = [f.resources.cleanup('s1'), f.resources.cleanup('s1')];
  assert.equal(f.calls.includes('deletePal'), false); release();
  await Promise.all([rejected, ...closings]);
  assert.equal(f.ledger.records.get('s1')!.conversationId, 'room-1'); assert.ok(f.ledger.records.get('s1')!.remoteEnded);
  assert.ok(f.calls.indexOf('endConversation') < f.calls.indexOf('deletePal')); assert.equal(f.calls.filter(c => c === 'deletePal').length, 1);
  const persisted = JSON.parse(await readFile(f.path, 'utf8'))[0]; assert.equal(persisted.conversationId, 'room-1'); assert.equal(persisted.palDeleted, true);
});

test('uncertain in-flight room outcome stays unresolved after close and never deletes the associated PAL', async t => {
  const f = await setup(t); let enter!: () => void; let release!: () => void;
  const started = new Promise<void>(r => { enter = r; }); const blocked = new Promise<void>(r => { release = r; });
  f.api.createConversation = async () => { enter(); await blocked; throw new TavusError(undefined, true); };
  const creation = f.create(); const rejected = assert.rejects(creation); await started;
  const closing = f.resources.cleanup('s1'); release(); await Promise.all([rejected, closing]);
  assert.equal(f.calls.includes('deletePal'), false); assert.equal(f.ledger.records.get('s1')!.outcomeUnknown, true);
});

test('definite PAL failure and failed durable intent leave no false unknown resource or extra upstream request', async t => {
  const f = await setup(t); f.api.createPal = async () => { throw new TavusError(400, false); };
  await assert.rejects(f.create()); assert.equal(f.ledger.records.get('s1')!.palDeleted, true); assert.equal(f.calls.includes('deletePal'), false);
  const g = await setup(t); const save = g.ledger.save.bind(g.ledger); let first = true;
  g.ledger.save = async () => { if (first) { first = false; throw new Error('disk-failure'); } await save(); };
  await assert.rejects(g.create(), /disk-failure/); assert.equal(g.calls.length, 0);
  assert.equal(g.ledger.records.get('s1')!.outcomeUnknown, undefined); assert.equal(g.ledger.records.get('s1')!.palDeleted, true);
});

test('ledger rejects malformed, secret-bearing or inconsistent records without accepting a partial load', async t => {
  const f = await setup(t); await f.create(); const valid = f.ledger.records.get('s1')!;
  for (const records of [[valid, { ...valid, sessionId: 's2', cleanupAttempts: 'bad' }], [valid, valid],
    [{ ...valid, palDeleted: true, remoteEnded: false }], [{ ...valid, api_key: 'SECRET-MARKER' }],
    [{ ...valid, palId: undefined }], [{ ...valid, palDeleted: true, remoteEnded: true, pending: 'conversation' }]]) {
    await writeFile(f.path, JSON.stringify(records)); const read = new ResourceLedger(f.path);
    await assert.rejects(read.load(), /invalid_ledger/); assert.equal(read.records.size, 0);
  }
  await writeFile(f.path, 'SECRET-MARKER not JSON');
  await assert.rejects(new ResourceLedger(f.path).load(), error => error instanceof Error && error.message === 'invalid_ledger');
});
