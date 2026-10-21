import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { freshJsonEvidence, runOfflineVerification, type VerificationContext, type VerificationStep } from '../packages/verification/runner.js';
import { brandSamples, prepareBrandReview } from '../eval/brand-samples.js';

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'askkai-verification-')); t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'README.md'), 'source-version-one');
  const runtimeDirectory = join(root, '.runtime'); await mkdir(runtimeDirectory);
  return { root, runtimeDirectory };
}
const reportStep: VerificationStep = { id: 'report', command: ['synthetic-check'],
  validate: c => freshJsonEvidence(c, 'probe.json', 'synthetic-test', r => r.result === 'passed') };
async function result(context: VerificationContext, runId = context.runId) {
  await writeFile(join(context.runDirectory, 'probe.json'), JSON.stringify({ timestamp: new Date().toISOString(),
    verification_run_id: runId, kind: 'synthetic-test', result: 'passed' }));
}

test('verification failure replaces an old green index, stops later commands and preserves explicit not-run', async t => {
  const f = await fixture(t); await writeFile(join(f.runtimeDirectory, 'verification-latest.json'), '{"status":"passed","verification_run_id":"OLD"}');
  const executed: string[] = [];
  const report = await runOfflineVerification({ ...f, steps: [{ id: 'first', command: ['fake'] }, { id: 'later', command: ['fake'] }],
    execute: async step => { executed.push(step.id); const current = JSON.parse(await readFile(join(f.runtimeDirectory, 'verification-latest.json'), 'utf8'));
      assert.equal(current.status, 'running'); assert.notEqual(current.verification_run_id, 'OLD'); return 7; } });
  assert.deepEqual(executed, ['first']); assert.equal(report.status, 'failed'); assert.equal(report.steps[0]!.exit_code, 7);
  assert.equal(report.steps[1]!.status, 'not-run');
  assert.equal(JSON.parse(await readFile(join(f.runtimeDirectory, 'verification-latest.json'), 'utf8')).status, 'failed');
});

test('successful command cannot reuse an old report or a report from a different verification run', async t => {
  for (const wrongRun of [false, true]) {
    const f = await fixture(t); await writeFile(join(f.runtimeDirectory, 'probe.json'), '{"result":"passed"}');
    const report = await runOfflineVerification({ ...f, steps: [reportStep], execute: async (_s, c) => {
      if (wrongRun) await result(c, 'old-run-id'); return 0;
    } });
    assert.equal(report.status, 'failed'); assert.equal(report.steps[0]!.error, 'report_invalid_or_missing'); assert.equal(report.steps[0]!.artifact, null);
  }
});

test('source edits during successful checks prevent a whole-run pass', async t => {
  const f = await fixture(t);
  const report = await runOfflineVerification({ ...f, steps: [reportStep], execute: async (_s, c) => {
    await result(c); await writeFile(join(f.root, 'README.md'), 'source-version-two'); return 0;
  } });
  assert.equal(report.steps[0]!.status, 'passed'); assert.equal(report.status, 'failed');
  assert.equal(report.error, 'source_changed_during_verification'); assert.notEqual(report.source_fingerprint.start, report.source_fingerprint.end);
});

test('fresh successful runs keep distinct artifact directories, content hashes and unchanged source fingerprints', async t => {
  const f = await fixture(t);
  const execute = async (_s: VerificationStep, c: VerificationContext) => { await result(c); return 0; };
  const a = await runOfflineVerification({ ...f, steps: [reportStep], execute });
  const b = await runOfflineVerification({ ...f, steps: [reportStep], execute });
  assert.equal(a.status, 'passed'); assert.equal(b.status, 'passed'); assert.notEqual(a.report_directory, b.report_directory);
  assert.match(b.steps[0]!.artifact!.sha256, /^[a-f0-9]{64}$/u); assert.equal(b.source_fingerprint.start, b.source_fingerprint.end);
  assert.equal(b.real_supplier, 'not-run'); assert.equal(b.real_media, 'not-run');
});

test('20 brand samples distinguish fixed speech from stimuli and cannot imply generated media or approval', () => {
  const report = prepareBrandReview(); assert.equal(report.sample_count, 20); assert.equal(new Set(brandSamples.map(s => s.id)).size, 20);
  assert.ok(brandSamples.some(s => s.kind === 'fixed-utterance')); assert.ok(brandSamples.some(s => s.kind === 'dialogue-stimulus'));
  for (const category of ['pronunciation', 'numbers', 'teaching', 'identity']) assert.ok(brandSamples.some(s => s.category === category));
  assert.ok(report.samples.every(s => s.review.status === 'not-run' && s.review.brandApproval === null && s.review.actualText === null));
  assert.equal(report.generated_audio_video, false); assert.equal(report.brand_approval, 'not-evaluated');
  report.samples[0]!.observe.push('test-only'); assert.equal(brandSamples[0]!.observe.includes('test-only'), false);
});
