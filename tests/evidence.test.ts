import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Sessions } from '../apps/gateway/state.js';
import { Summaries } from '../apps/gateway/summaries.js';
import { getMockContext } from '../packages/business/context.js';
import { MockLearningStore } from '../packages/business/learning-store.js';
import { buildSummary } from '../packages/evidence/summary.js';

function fixture(allowed = false, modality: 'text' | 'audio_transcript' | 'unknown' = 'text') {
  const sessions = new Sessions(); const { session: s } = sessions.create(getMockContext('alex', allowed));
  s.status = 'active'; const run = sessions.begin(s, ['我昨天去踢足球了。'], modality, true); run.status = 'completed';
  const source = s.evidence.inspect().inputs[0]!;
  return { sessions, s, run, source };
}
function close(f: ReturnType<typeof fixture>, coordinator: Summaries) {
  f.s.status = 'closing'; f.sessions.revoke(f.s); coordinator.freeze(f.s, 'user_end'); f.s.status = 'closed';
  return coordinator.view(f.s);
}

test('summary quotes accepted input and cannot infer practice from a teacher plan/draft', () => {
  const f = fixture(); f.run.text = '你已经掌握了这句话，第三声很标准。';
  f.run.decision = { action: 'INVITE_PRACTICE', reason: 'plan', source: 'pi' };
  const coordinator = new Summaries(); const summary = close(f, coordinator);
  assert.equal(summary.attempts.length, 0); assert.equal(summary.note, '本次以交流为主。');
  assert.equal(summary.excerpts[0]!.quote, '我昨天去踢足球了。'); assert.equal(summary.excerpts[0]!.evidenceId, f.source.id);
  assert.doesNotMatch(summary.oralReview, /已经掌握|第三声很标准/); assert.equal(summary.presentation, 'unknown');
  assert.equal(summary.save.status, 'not_requested');
});

test('revisions invalidate old references, reject arbitrary quote/cross-session facts, and freeze a stable cutoff', () => {
  const f = fixture();
  f.s.evidence.select('attempt', f.source.id, '踢足球');
  assert.throws(() => f.s.evidence.select('topic', f.source.id, '去游泳'), /unsupported/);
  const other = fixture(); assert.throws(() => f.s.evidence.select('topic', other.source.id, '踢足球'), /unsupported/);
  const corrected = f.sessions.begin(f.s, ['我昨天去游泳了。'], 'text', true); corrected.status = 'completed';
  assert.equal(f.s.evidence.inspect().selections.length, 0);
  assert.throws(() => f.s.evidence.select('attempt', f.source.id, '踢足球'), /unsupported/);
  const coordinator = new Summaries(); const summary = close(f, coordinator);
  assert.equal(summary.excerpts[0]!.quote, '我昨天去游泳了。'); assert.equal(summary.attempts.length, 0);
  assert.equal(coordinator.freeze(f.s, 'expired').id, summary.id);
  assert.throws(() => f.s.evidence.select('topic', f.s.evidence.inspect().inputs[0]!.id, '游泳'), /frozen/);
  summary.excerpts[0]!.quote = '伪造'; assert.notEqual(coordinator.view(f.s).excerpts[0]!.quote, '伪造');
});

test('typed attempts and transcript candidates stay distinct, with no pronunciation/mastery rating', () => {
  for (const modality of ['text', 'audio_transcript', 'unknown'] as const) {
    const f = fixture(false, modality); f.s.evidence.select('topic', f.source.id, '足球'); f.s.evidence.select('attempt', f.source.id, '踢足球');
    const summary = close(f, new Summaries());
    assert.equal(summary.topics[0]!.quote, '足球');
    assert.equal(summary.attempts.length, modality === 'text' ? 1 : 0);
    assert.equal(summary.candidates.length, modality === 'text' ? 0 : 1);
    const attempt = [...summary.attempts, ...summary.candidates][0]!;
    assert.equal(attempt.assessment, 'not_assessed'); assert.equal(attempt.pronunciation, 'unverified');
    assert.equal(summary.completeness, modality === 'text' ? 'complete' : 'partial');
  }
});

test('broken source references fail closed and interrupted/expired snapshots stay partial', () => {
  const f = fixture(); f.s.evidence.select('attempt', f.source.id, '踢足球');
  f.run.status = 'partial'; const summary = close(f, new Summaries()); assert.equal(summary.completeness, 'partial');
  const snapshot = f.s.evidence.freeze({ sessionId: f.s.id, cutoffVersion: f.s.stateVersion,
    consentVersion: 1, contextVersion: 1, connectionEpoch: 1 }, 'expired', false);
  snapshot.inputs = []; assert.throws(() => buildSummary(snapshot), /source_missing/);
});

test('save requires both permission and explicit choice, pending status has no receipt, concurrent retries are idempotent', async () => {
  let release!: () => void; const blocked = new Promise<void>(r => { release = r; });
  const store = new MockLearningStore({ beforeCommit: () => blocked }); const coordinator = new Summaries(store);
  const denied = fixture(false); const d = close(denied, coordinator);
  assert.equal(coordinator.requestSave(denied.s, d.id, 1).save.status, 'denied'); assert.equal(store.size, 0);
  const f = fixture(true); const summary = close(f, coordinator);
  assert.equal(coordinator.view(f.s).save.status, 'not_requested'); assert.equal(store.size, 0);
  const pending = coordinator.requestSave(f.s, summary.id, 1); assert.equal(pending.save.status, 'pending'); assert.equal(pending.save.receipt, undefined);
  coordinator.requestSave(f.s, summary.id, 1); release();
  const saved = await coordinator.wait(f.s); assert.equal(saved.save.status, 'saved'); assert.equal(store.size, 1);
  assert.equal(saved.save.receipt!.summaryId, summary.id); assert.equal(saved.save.receipt!.mode, 'mock-memory');
  assert.equal(coordinator.requestSave(f.s, summary.id, 1).save.receipt!.id, saved.save.receipt!.id);
  assert.throws(() => coordinator.requestSave(f.s, 'wrong-summary', 1), /stale_summary/);
});

test('consent/context/state/epoch changes and context retirement fence a delayed save before commit', async () => {
  for (const field of ['consent', 'context', 'state', 'epoch', 'retired']) {
    let release!: () => void; const blocked = new Promise<void>(r => { release = r; });
    const store = new MockLearningStore({ beforeCommit: () => blocked }); const coordinator = new Summaries(store);
    const f = fixture(true); const summary = close(f, coordinator); coordinator.requestSave(f.s, summary.id, 1);
    await Promise.resolve();
    if (field === 'consent') { f.s.context.consentVersion++; f.s.context.saveAllowed = false; }
    if (field === 'context') f.s.context.version++;
    if (field === 'state') f.s.stateVersion++;
    if (field === 'epoch') f.s.connectionEpoch++;
    if (field === 'retired') f.s.retired = true;
    release(); const result = await coordinator.wait(f.s); assert.equal(result.save.status, 'denied', field); assert.equal(store.size, 0, field);
  }
});

test('lost acknowledgement never invents success and retries the same write without duplicate effects', async () => {
  let fail = true;
  const store = new MockLearningStore({ afterCommit: async () => { if (fail) { fail = false; throw new Error('lost_ack'); } } });
  const coordinator = new Summaries(store); const f = fixture(true); const summary = close(f, coordinator);
  coordinator.requestSave(f.s, summary.id, 1); const failed = await coordinator.wait(f.s);
  assert.equal(failed.save.status, 'failed'); assert.equal(failed.save.receipt, undefined); assert.equal(store.size, 1);
  coordinator.requestSave(f.s, summary.id, 1); const saved = await coordinator.wait(f.s);
  assert.equal(saved.save.status, 'saved'); assert.equal(store.size, 1);
});

test('malformed receipt and idempotency payload conflicts cannot be shown as saved', async () => {
  const coordinator = new Summaries({ save: async () => ({ status: 'saved', mode: 'mock-memory', id: 'bad' }) as never });
  const f = fixture(true); const summary = close(f, coordinator);
  coordinator.requestSave(f.s, summary.id, 1); assert.equal((await coordinator.wait(f.s)).save.status, 'failed');
  const store = new MockLearningStore(); const request = { summary, idempotencyKey: 'same-key', canCommit: () => true };
  await store.save(request);
  await assert.rejects(store.save({ ...request, summary: { ...summary, note: 'changed' } }), /idempotency_conflict/);
});

test('empty/gapped input histories cannot become complete lessons and old confirmed receipts are not silently deleted', async () => {
  const sessions = new Sessions(); const { session: empty } = sessions.create(getMockContext('alex')); empty.status = 'closed';
  const summaries = new Summaries(); const noData = summaries.freeze(empty, 'user_end');
  assert.equal(noData.completeness, 'partial'); assert.equal(noData.oralReview, '本次没有可引用的交流记录。');
  const f = fixture(true); const summary = close(f, summaries);
  summaries.requestSave(f.s, summary.id, 1); const saved = await summaries.wait(f.s);
  f.s.context.saveAllowed = false; f.s.context.consentVersion++;
  const historical = summaries.view(f.s); assert.equal(historical.save.status, 'saved');
  assert.equal(historical.save.receipt!.id, saved.save.receipt!.id); assert.equal(historical.save.current_binding_valid, false);
  assert.throws(() => summaries.requestSave(f.s, summary.id, 1), /stale_summary/);
  const { session: gapped } = sessions.create(getMockContext('maya')); gapped.status = 'active';
  const run = sessions.begin(gapped, ['仅供应商历史', '本次接受的输入'], 'text', true); run.status = 'completed'; gapped.status = 'closed';
  const partial = summaries.freeze(gapped, 'user_end'); assert.equal(partial.completeness, 'partial'); assert.equal(partial.excerpts.length, 1);
});
