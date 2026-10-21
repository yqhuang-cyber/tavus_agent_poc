import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Sessions } from '../apps/gateway/state.js';
import { Summaries } from '../apps/gateway/summaries.js';
import { getMockContext } from '../packages/business/context.js';
import { ReviewClosing, type ReviewClosingPort } from '../packages/evidence/review-closing.js';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const ack = { source: 'offline-simulation' as const, status: 'finished' as const };
function fixture(empty = false) {
  const sessions = new Sessions(); const { session } = sessions.create(getMockContext('alex')); session.status = 'active';
  if (!empty) sessions.begin(session, ['我今天聊了足球。'], 'text', true).status = 'completed';
  const summaries = new Summaries(); const preview = summaries.preview(session); const calls: string[] = [];
  const port: ReviewClosingPort = {
    speakReview: async (command, _signal, generated) => { calls.push(`speak:${command.text}`); generated(); return ack; },
    finalize: async (summary, canCommit, committed) => {
      assert.equal(canCommit(), true); const frozen = summaries.freeze(session, 'user_end'); assert.equal(frozen.id, summary.id);
      committed(); calls.push('finalize'); session.status = 'closed'; return { summaryId: frozen.id, cutoffVersion: frozen.cutoffVersion };
    },
    closeImmediately: async reason => { calls.push(reason); session.status = 'closed'; },
  };
  const create = (limits = { reviewMs: 200, finalizeMs: 200 }) => new ReviewClosing(preview,
    () => session.status === 'closed' ? null : summaries.preview(session), port, limits);
  return { sessions, session, summaries, preview, calls, port, create };
}

test('review uses the same preview and final card, only freezes after acknowledgement, and remains playback unknown', async () => {
  const f = fixture(); const delivered = deferred<typeof ack>(); const generated = deferred<void>();
  f.port.speakReview = async (command, _signal, onGenerated) => {
    assert.equal(command.text, f.preview.oralReview); onGenerated(); generated.resolve(); return delivered.promise;
  };
  const closing = f.create(); const pending = closing.start(); assert.equal(closing.start(), pending); await generated.promise;
  assert.equal(closing.view().phase, 'waiting-ack'); assert.equal(f.session.evidence.inspect().frozen, false);
  assert.equal(f.calls.includes('finalize'), false); delivered.resolve(ack); const final = await pending;
  assert.equal(final.phase, 'finalized'); assert.equal(final.presentation, 'unknown');
  assert.equal(final.resourceRelease, 'unverified'); assert.equal(final.card.id, f.summaries.view(f.session).id);
  assert.equal(f.calls.filter(c => c === 'finalize').length, 1);
});

test('new accepted input cancels review without freezing the old preview or closing the conversation', async () => {
  const f = fixture(); const delivered = deferred<typeof ack>(); const entered = deferred<void>(); let onGenerated!: () => void;
  f.port.speakReview = async (_c, _s, generated) => { onGenerated = generated; entered.resolve(); return delivered.promise; };
  const closing = f.create(); const pending = closing.start(); await entered.promise;
  f.sessions.begin(f.session, ['我今天聊了足球。', '我还想聊音乐。'], 'text', true).status = 'completed'; closing.cancel('new-input');
  const final = await pending; assert.equal(final.phase, 'resumed'); assert.equal(final.cardScope, 'obsolete-preview');
  assert.equal(f.session.evidence.inspect().frozen, false); assert.equal(f.calls.length, 0);
  onGenerated(); delivered.resolve(ack); await Promise.resolve(); assert.equal(closing.view().phase, 'resumed');
  assert.notEqual(f.summaries.preview(f.session).id, f.preview.id);
});

test('permission, context or epoch changes invalidate a delayed review without committing a stale summary', async () => {
  for (const field of ['consentVersion', 'contextVersion', 'epoch'] as const) {
    const f = fixture(); const entered = deferred<void>(); const delivered = deferred<typeof ack>();
    f.port.speakReview = async () => { entered.resolve(); return delivered.promise; };
    const closing = f.create(); const pending = closing.start(); await entered.promise;
    if (field === 'epoch') f.session.connectionEpoch++;
    else if (field === 'contextVersion') f.session.context.version++;
    else f.session.context.consentVersion++;
    delivered.resolve(ack); assert.equal((await pending).phase, 'resumed'); assert.equal(f.session.evidence.inspect().frozen, false);
    assert.equal(f.calls.includes('finalize'), false);
  }
});

test('uncooperative review times out and proceeds to finalization without asserting it was heard', async () => {
  const f = fixture(); f.port.speakReview = async () => new Promise<never>(() => {});
  const result = await f.create({ reviewMs: 10, finalizeMs: 200 }).start();
  assert.equal(result.phase, 'finalized'); assert.equal(result.review, 'timed-out'); assert.equal(result.presentation, 'unknown');
});

test('immediate exit bypasses waiting review, deduplicates cleanup and ignores a late delivery acknowledgement', async () => {
  const f = fixture(); const entered = deferred<void>(); const delivered = deferred<typeof ack>();
  f.port.speakReview = async () => { entered.resolve(); return delivered.promise; };
  const closing = f.create(); const pending = closing.start(); await entered.promise;
  closing.cancel('immediate-exit'); closing.cancel('immediate-exit'); const result = await pending;
  assert.equal(result.phase, 'exited'); assert.equal(f.calls.filter(c => c === 'immediate-exit').length, 1);
  assert.equal(f.calls.includes('finalize'), false); delivered.resolve(ack); await Promise.resolve(); assert.equal(closing.view().phase, 'exited');
});

test('late finalization cannot commit after newer input and empty sessions keep an honest no-record review', async () => {
  const f = fixture(); const entered = deferred<void>(); const resume = deferred<void>();
  f.port.finalize = async (_summary, canCommit, committed) => {
    entered.resolve(); await resume.promise; assert.equal(canCommit(), false); assert.throws(committed, /cutoff_invalid/); throw new Error('stale');
  };
  const closing = f.create(); const pending = closing.start(); await entered.promise;
  f.sessions.begin(f.session, ['我今天聊了足球。', '继续聊。'], 'text', true).status = 'completed'; closing.cancel('new-input');
  assert.equal((await pending).phase, 'resumed'); resume.resolve(); await Promise.resolve(); assert.equal(f.session.evidence.inspect().frozen, false);
  const empty = fixture(true); const result = await empty.create().start();
  assert.match(result.card.oralReview, /没有可引用/); assert.equal(result.card.attempts.length, 0); assert.equal(result.finalized, true);
});

test('finalization deadline prevents a late commit and stale frozen previews cannot be rebound to new consent', async () => {
  const f = fixture(); const late = deferred<void>(); let lateGuard!: () => boolean;
  f.port.finalize = async (_summary, canCommit) => { lateGuard = canCommit; await late.promise; assert.equal(canCommit(), false); throw new Error('too-late'); };
  const result = await f.create({ reviewMs: 200, finalizeMs: 10 }).start();
  assert.equal(result.phase, 'failed'); assert.equal(result.finalized, false); assert.equal(lateGuard(), false); late.resolve();
  const g = fixture(); await g.create().start(); g.session.context.consentVersion++;
  assert.throws(() => g.summaries.preview(g.session), /stale_summary_preview/);
});

test('explicit exit has a bounded cleanup wait even when the injected adapter never acknowledges', async () => {
  const f = fixture(); f.port.closeImmediately = async () => new Promise<never>(() => {});
  const closing = f.create({ reviewMs: 200, finalizeMs: 10 }); closing.cancel('disconnect');
  const result = await closing.start(); assert.equal(result.phase, 'failed'); assert.equal(result.resourceRelease, 'unverified');
  assert.equal(f.calls.some(c => c.startsWith('speak:')), false);
});
