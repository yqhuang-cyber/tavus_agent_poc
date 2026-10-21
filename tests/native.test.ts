import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { NativeResources } from '../packages/tavus/native-resources.js';
import { TavusError } from '../packages/tavus/client.js';
import { NativeSessions } from '../apps/server/session.js';
import { NativeHooks } from '../apps/server/hooks.js';
import { PiTutor, fixturePiOptions, type Tutor } from '../packages/tutor/runtime.js';
import { deferred, nativeApi, nativeConfig } from './native-fixtures.js';
import { loadNativeSigningSeed } from '../packages/tavus/native-config.js';

const tutor = () => new PiTutor(fixturePiOptions());
test('tool signing seed is generated once outside browser credentials and corrupt seed files are not overwritten', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'native-seed-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'seed'); const first = await loadNativeSigningSeed(file); assert.match(first, /^[a-f0-9]{64}$/u);
  assert.equal(await loadNativeSigningSeed(file), first); await writeFile(file, 'bad');
  await assert.rejects(loadNativeSigningSeed(file), /invalid_native_signing_seed/); assert.equal(await readFile(file, 'utf8'), 'bad');
});
const voiceEvent = (id: string, seq: number, text: string, room = 'room-1') => ({ message_type: 'conversation', event_type: 'conversation.utterance',
  conversation_id: room, inference_id: id, seq, properties: { role: 'user', speech: text } });
function sessionFixture(t: Tutor = tutor(), planMs = 200) {
  const core = new NativeSessions(t, 'live', Date.now, planMs); const s = core.create('owner', 'alex', false, true); s.status = 'active'; s.conversationId = 'room-1'; return { core, s };
}

test('native PAL preserves Tavus model, registers versioned HMAC tools and reuses shared configuration without secrets in the ledger', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'native-ledger-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const f = nativeApi(); const resources = new NativeResources(join(dir, 'resources.json'), f.api, nativeConfig);
  const first = await resources.create('one', Date.now() + 900000, 'context', 'hello', () => true);
  await resources.create('two', Date.now() + 900000, 'context', 'hello', () => true);
  assert.equal(first.conversation_id, 'room-1'); assert.equal(f.calls.filter(c => c.startsWith('tool:')).length, 3);
  assert.equal(f.calls.filter(c => c === 'pal').length, 1); assert.equal(f.calls.filter(c => c === 'attach').length, 1);
  assert.equal(nativeConfig.pal.layers.llm.model, 'tavus-gemma-4'); assert.equal('base_url' in nativeConfig.pal.layers.llm, false);
  assert.equal(nativeConfig.tools[2]!.trigger_type, 'post_call'); assert.equal('origin' in nativeConfig.tools[2]!, false);
  assert.doesNotMatch(await readFile(resources.path, 'utf8'), /SYNTHETIC-PRIVATE|secret|meeting_token|operatorToken/);
  assert.equal(await resources.cleanup('one'), true); assert.equal(await resources.cleanup('one'), true);
  assert.equal(f.calls.some(c => c.startsWith('delete')), false);
});

test('exit during native configuration fences paid room creation while shared setup may finish safely', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'native-ledger-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const f = nativeApi(); const gate = deferred<void>(); const entered = deferred<void>(); const original = f.api.createTool;
  f.api.createTool = async b => { entered.resolve(); await gate.promise; return original(b); };
  const resources = new NativeResources(join(dir, 'resources.json'), f.api, nativeConfig);
  const creation = resources.create('one', Date.now() + 900000, '', '', () => true); const rejected = assert.rejects(creation, /native_start_cancelled/);
  await entered.promise; const closed = resources.cleanup('one'); gate.resolve(); await rejected; assert.equal(await closed, true);
  assert.equal(f.calls.some(c => c.startsWith('room:')), false);
});

test('native cleanup waits for late room IDs, ends and verifies them, and withholds late credentials', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'native-ledger-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const f = nativeApi(); const entered = deferred<void>(); const gate = deferred<void>(); const original = f.api.createConversation;
  f.api.createConversation = async b => { entered.resolve(); await gate.promise; return original(b); };
  const resources = new NativeResources(join(dir, 'resources.json'), f.api, nativeConfig);
  const creation = resources.create('one', Date.now() + 900000, '', '', () => true); const rejected = assert.rejects(creation, /native_start_cancelled/);
  await entered.promise; const closed = resources.cleanup('one'); assert.equal(f.calls.some(c => c.startsWith('end:')), false);
  gate.resolve(); await rejected; assert.equal(await closed, true);
  assert.deepEqual(f.calls.slice(-3), ['get:room-1', 'end:room-1', 'get:room-1']);
});

test('unknown native create outcome blocks further creates and malformed ledgers cannot be partially accepted', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'native-ledger-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const f = nativeApi(); let attempts = 0; f.api.createConversation = async () => { attempts++; throw new TavusError(undefined, true, 'timeout'); };
  const resources = new NativeResources(join(dir, 'resources.json'), f.api, nativeConfig);
  await assert.rejects(resources.create('one', Date.now() + 900000, '', '', () => true));
  assert.equal(await resources.cleanup('one'), false);
  await assert.rejects(resources.create('two', Date.now() + 900000, '', '', () => true), /require_reconciliation/); assert.equal(attempts, 1);
  const restored = new NativeResources(resources.path, f.api, nativeConfig); await restored.load(); assert.equal(restored.view().rooms[0]!.unknown, true);
  await writeFile(resources.path, JSON.stringify({ version: 1, configs: [], rooms: [{ sessionId: 'bad', secret: 'PRIVATE' }] }));
  await assert.rejects(new NativeResources(resources.path, f.api, nativeConfig).load(), /ledger_invalid/);
});

test('native input normalization deduplicates finals, preserves legitimate repeats, revises current input and rejects wrong rooms/epochs', async () => {
  const { core, s } = sessionFixture();
  assert.equal(core.event(s, voiceEvent('a', 1, '你好。'), 1).accepted, true);
  assert.equal(core.event(s, voiceEvent('a', 2, '你好。'), 1).accepted, false);
  assert.equal(core.event(s, voiceEvent('b', 3, '你好。'), 1).accepted, true);
  assert.equal(core.event(s, voiceEvent('b', 4, '只用中文。'), 1).accepted, true);
  assert.equal(s.inputs.length, 2); assert.equal(s.teaching.language.mode, 'chinese_only');
  assert.equal(s.evidence.inspect().inputs[1]!.provenance, 'client-reported');
  assert.equal(core.event(s, voiceEvent('a', 5, '旧回合更正。'), 1).accepted, false);
  assert.throws(() => core.event(s, voiceEvent('c', 6, '另一个房间', 'room-2'), 1), /stale_or_wrong_room/);
  assert.throws(() => core.event(s, voiceEvent('c', 6, '旧连接'), 0), /stale_or_wrong_room/);
  await s.pending?.promise;
});

test('late uncooperative planner output cannot overwrite a newer input or a closed session; tool and background tasks share one result', async () => {
  const pending = deferred<Awaited<ReturnType<Tutor['decide']>>>(); let calls = 0;
  const custom: Tutor = { decide: async () => { calls++; return calls === 1 ? pending.promise : { action: 'RESPOND', reason: 'latest', source: 'pi' }; }, speak: async () => { throw new Error('native-must-not-generate-speech'); } };
  const { core, s } = sessionFixture(custom);
  core.text(s, 'a', '帮我练习说中文。'); const old = s.pending!.promise;
  core.text(s, 'b', '我不想练习。'); const current = core.plan(s); assert.equal(current, s.pending!.promise);
  await current; pending.resolve({ action: 'INVITE_PRACTICE', reason: 'stale', source: 'pi' }); await old;
  assert.equal(s.plans.at(-1)!.decision!.reason, 'latest'); assert.equal(s.plans[0]!.status, 'cancelled'); assert.equal(calls, 2);
  core.commitClose(s, 'immediate-exit'); assert.equal(s.status, 'closing'); assert.equal(s.summary!.attempts.length, 0);
});

test('planning timeout is bounded even for an uncooperative model and is visible as rule fallback', async () => {
  const { core, s } = sessionFixture({ decide: async () => new Promise<never>(() => {}), speak: async () => {} }, 15);
  core.text(s, 'a', '你好'); const plan = await s.pending!.promise;
  assert.equal(plan.status, 'rule'); assert.equal(plan.reasonCode, 'model-timeout'); assert.equal(s.status, 'active');
});

test('context compilation fits the RTC byte budget without dropping current policy or pretending excerpt coverage is complete', async () => {
  const { core, s } = sessionFixture({ decide: async () => ({ action: 'RESPOND', reason: '规划'.repeat(100), source: 'pi' }), speak: async () => {} });
  s.context.preferences.chineseOnly = true;
  for (let i = 0; i < 12; i++) core.text(s, `input-${i}`, '中文'.repeat(1500));
  await s.pending!.promise; const context = core.context(s);
  assert.ok(Buffer.byteLength(context, 'utf8') <= 3500); assert.match(context, /当前只用中文/);
  assert.match(context, /bounded-input-excerpts\/partial/); assert.match(context, /不能根据文字评定/);
  const preview = await core.prepareClose(s, true); assert.ok(Buffer.byteLength(core.context(s), 'utf8') <= 3500);
  assert.ok(core.context(s).includes(preview.summary.id)); assert.equal(s.inputs.length, 12);
});

test('normal close preview is same-source, new input revokes it, and only current explicit confirmation can freeze/save', async () => {
  const { core, s } = sessionFixture(); core.text(s, 'a', '我今天踢足球了。'); await s.pending!.promise;
  const preview = await core.prepareClose(s, true); assert.equal(s.evidence.inspect().frozen, false);
  core.text(s, 'b', '我还想聊音乐。'); assert.equal(s.closing, undefined);
  assert.throws(() => core.commitClose(s, 'user-confirmed', preview.id), /stale_closing/);
  const next = await core.prepareClose(s, true); core.commitClose(s, 'user-confirmed', next.id); await core.save(s);
  assert.equal(s.summary!.id, next.summary.id); assert.equal(s.receipt!.summaryId, next.summary.id);
  assert.equal(s.summary!.presentation, 'unknown'); assert.equal(s.playback, 'user-confirmed');
  const receipt = s.receipt!.id; await core.save(s); assert.equal(s.receipt!.id, receipt);
  assert.equal(s.summary!.attempts.length, 0); core.revokeConsent(s); assert.equal(s.context.saveAllowed, false);
});

test('HMAC tools require exact raw bytes, bounded arguments, known conversations and idempotent unchanged versions', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'native-hooks-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const { core, s } = sessionFixture(); core.text(s, 'a', '我想练习说昨天的事。'); await s.pending!.promise;
  const hooks = new NativeHooks(core, nativeConfig, join(dir, 'jobs.json')); await hooks.load();
  const envelope = { name: nativeConfig.names.teaching, arguments: JSON.stringify({ reason: 'practice_request', student_request: '练习' }), tool_call_id: 'one', conversation_id: 'room-1' };
  const raw = Buffer.from(JSON.stringify(envelope)); const signature = createHmac('sha256', nativeConfig.toolSecret).update(raw).digest('hex');
  await assert.rejects(hooks.handle(raw, undefined, false), /signature_required/);
  await assert.rejects(hooks.handle(Buffer.concat([raw, Buffer.from(' ')]), signature, false), /invalid_tool_signature/);
  const first = await hooks.handle(raw, signature, false); assert.deepEqual(await hooks.handle(raw, signature, false), first); assert.equal(s.toolCalls, 1);
  const changed = Buffer.from(JSON.stringify({ ...envelope, arguments: '{}' }));
  await assert.rejects(hooks.handle(changed, createHmac('sha256', nativeConfig.toolSecret).update(changed).digest('hex'), false), /idempotency_conflict/);
  core.text(s, 'b', '只想聊天。'); assert.equal((await hooks.handle(raw, signature, false) as { status: string }).status, 'stale'); await s.pending!.promise;
});

test('post-call receipt is durable, never promotes candidates into learning facts and cannot revive authority after restart', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'native-hooks-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const { core, s } = sessionFixture(); core.text(s, 'a', '我今天踢足球了。'); await s.pending!.promise; core.commitClose(s, 'immediate-exit');
  const file = join(dir, 'jobs.json'); const hooks = new NativeHooks(core, nativeConfig, file); await hooks.load();
  const raw = Buffer.from(JSON.stringify({ name: nativeConfig.names.post, arguments: JSON.stringify({ summary_candidate: 'PRIVATE-CANDIDATE', attempt_candidates: ['踢足球', '掌握中文'] }),
    tool_call_id: 'post-one', conversation_id: 'room-1' }));
  const sig = createHmac('sha256', nativeConfig.postSecret).update(raw).digest('hex');
  assert.equal((await hooks.handle(raw, sig, true) as { acceptedLearningFacts: number }).acceptedLearningFacts, 0);
  const bytes = await readFile(file, 'utf8'); assert.doesNotMatch(bytes, /PRIVATE-CANDIDATE|踢足球|掌握中文/);
  assert.equal(JSON.parse(bytes)[0].matchedCandidates, 1); assert.equal(s.summary!.attempts.length, 0);
  const jobs = JSON.parse(bytes); jobs[0].status = 'pending'; await writeFile(file, JSON.stringify(jobs));
  await new NativeHooks(new NativeSessions(tutor(), 'fixture'), nativeConfig, file).load();
  assert.equal(JSON.parse(await readFile(file, 'utf8'))[0].status, 'authorization-expired');
});
