import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { LifecycleTimings } from '../packages/observability/lifecycle.js';
import { ResourceLedger, Resources } from '../packages/tavus/resources.js';
import { TavusError, palConfig, conversationConfig, type TavusApi } from '../packages/tavus/client.js';

test('lifecycle distinguishes running, failed, cancelled and unresolved attempts with honest bounded denominators', async () => {
  let now = 0; const metrics = new LifecycleTimings(() => now, 2);
  const a = metrics.start('s1', 'startup'); now = 5; assert.equal(metrics.view().stages.startup.running.sample_count, 0);
  a('cancelled'); a('succeeded'); assert.equal(metrics.view().stages.startup.cancelled.p50, 5);
  await assert.rejects(metrics.measure('s2', 'pal-create', async () => { throw new Error('PRIVATE-ERROR'); }, () => 'unresolved'));
  const active = metrics.start('s3', 'cleanup'); assert.equal(metrics.view().evicted_finished_samples, 1);
  assert.equal(metrics.view().stages['pal-create'].unresolved.attempt_count, 1); active('failed');
  assert.doesNotMatch(JSON.stringify(metrics.view()), /PRIVATE/); assert.equal(metrics.view().cost, null);
  const tiny = new LifecycleTimings(() => 1, 1); const finish = tiny.start('a', 'startup'); tiny.start('b', 'startup');
  assert.equal(tiny.view().dropped_active_samples, 1); finish('succeeded');
});

test('resource stages report unknown creation separately and do not label unresolved cleanup successful', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'askkai-stage-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const ledger = new ResourceLedger(join(dir, 'ledger.json')); const timing = new LifecycleTimings();
  const api = { createPal: async () => { throw new TavusError(undefined, true); } } as unknown as TavusApi;
  const resources = new Resources(ledger, api, timing);
  await assert.rejects(resources.create('s1', Date.now() + 1000, {}, () => ({})));
  assert.equal(timing.view().stages['pal-create'].unresolved.attempt_count, 1);
  assert.equal(timing.view().stages.cleanup.unresolved.attempt_count, 1);
  assert.equal(timing.view().stages.cleanup.succeeded.attempt_count, 0);
});

test('end acknowledgement alone is unresolved; GET ended and DELETE absence complete cleanup stage', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'askkai-stage-')); t.after(() => rm(dir, { recursive: true, force: true }));
  let ended = false; let config: Record<string, unknown> = {}; let deletes = 0;
  const api: TavusApi = { createPal: async body => { config = body; return { pal_id: 'p1' }; }, getPal: async () => ({ ...config, pal_id: 'p1' }),
    createConversation: async () => ({ conversation_id: 'r1', conversation_url: 'https://tavus.daily.co/r1', meeting_token: 'PRIVATE' }),
    getConversation: async () => ({ status: ended ? 'ended' : 'active' }), endConversation: async () => {}, deletePal: async () => { deletes++; } };
  const timing = new LifecycleTimings(); const resources = new Resources(new ResourceLedger(join(dir, 'ledger.json')), api, timing);
  await resources.create('s1', Date.now() + 1000, palConfig('s1', 'face', undefined, 'https://gateway.example', 'PRIVATE'),
    id => conversationConfig('s1', id, 'face', 'https://gateway.example', 'PRIVATE'));
  await resources.cleanup('s1'); assert.equal(deletes, 0);
  assert.equal(timing.view().stages['room-end-request'].succeeded.attempt_count, 1);
  assert.equal(timing.view().stages['room-end-verify'].unresolved.attempt_count, 1);
  assert.equal(timing.view().stages.cleanup.unresolved.attempt_count, 1);
  ended = true; await resources.cleanup('s1'); assert.equal(deletes, 1);
  assert.equal(timing.view().stages.cleanup.succeeded.attempt_count, 1);
  assert.doesNotMatch(JSON.stringify(timing.view()), /PRIVATE|meeting_token|api_key/);
});
