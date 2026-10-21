import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { freshJsonEvidence, runOfflineVerification, type VerificationStep } from '../packages/verification/runner.js';

if (process.argv.length !== 2) throw new Error('usage: verify:offline (no live options)');
const root = resolve('.'); process.umask(0o077);
const tests = (await readdir('tests')).filter(name => name.endsWith('.test.ts')).sort().map(name => `tests/${name}`);
const steps: VerificationStep[] = [
  { id: 'typecheck', command: ['node_modules/typescript/bin/tsc', '--noEmit'] },
  { id: 'tests', command: ['--import', 'tsx', '--test', '--test-reporter=spec', '--test-reporter-destination=stdout',
    '--test-reporter=tap', '--test-reporter-destination={run}/tests.tap', ...tests],
    validate: async context => {
      const bytes = await readFile(join(context.runDirectory, 'tests.tap')); const text = bytes.toString();
      const count = (name: string) => { const matches = [...text.matchAll(new RegExp(`^# ${name} (\\d+)$`, 'gmu'))];
        const last = matches.at(-1); if (!last) throw new Error('missing_test_summary'); return Number(last[1]); };
      const counts = { tests: count('tests'), passed: count('pass'), failed: count('fail'), skipped: count('skipped'), cancelled: count('cancelled'), todo: count('todo') };
      if (counts.tests <= 0 || counts.failed || counts.cancelled || counts.todo || counts.skipped || counts.passed !== counts.tests) throw new Error('invalid_test_summary');
      return { file: 'tests.tap', sha256: createHash('sha256').update(bytes).digest('hex'), counts };
    } },
  { id: 'probe', command: ['--import', 'tsx', 'scripts/probe-offline.ts'], validate: c => freshJsonEvidence(c, 'offline-probe.json', 'offline-synthetic',
    r => r.completed_turns === 20 && r.sessions === 2 && r.tavus_requests === 0 && r.real_supplier === 'not-run' && r.real_media === 'not-run') },
  { id: 'matrix', command: ['--import', 'tsx', 'scripts/eval-offline.ts'], validate: c => freshJsonEvidence(c, 'eval-offline.json', 'offline-synthetic',
    r => r.case_count === 36 && r.protocol_passed === 36 && r.teaching_state_passed === 36 && r.completed_turns === 80 && r.teaching_quality === 'not-evaluated') },
  { id: 'brand-review-preparation', command: ['--import', 'tsx', 'scripts/prepare-brand-review.ts'], validate: c => freshJsonEvidence(c, 'brand-review.json', 'offline-review-preparation',
    r => r.sample_count === 20 && r.real_outputs === 'not-run' && r.brand_approval === 'not-evaluated' && r.generated_audio_video === false) },
];
const report = await runOfflineVerification({ root, runtimeDirectory: resolve('.runtime'), steps,
  execute: (step, context) => new Promise<number>((resolveResult, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, ASKKAI_OFFLINE_RUN_ID: context.runId, ASKKAI_OFFLINE_REPORT_DIR: context.runDirectory };
    delete env.NODE_TEST_CONTEXT; // These are CLI checks, not test IPC workers; proxy/TLS/credentials stay inherited.
    const child = spawn(process.execPath, step.command.map(arg => arg.replace('{run}', context.runDirectory)),
      { cwd: root, env, stdio: 'inherit', detached: process.platform !== 'win32' });
    let expired = false; let interrupted = false;
    const kill = (signal: NodeJS.Signals) => {
      try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal); else child.kill(signal); } catch { /* Already exited. */ }
    };
    let force: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => { expired = true; kill('SIGTERM'); force = setTimeout(() => kill('SIGKILL'), 2000); force.unref(); }, 90000);
    const stop = () => { interrupted = true; kill('SIGTERM'); if (!force) { force = setTimeout(() => kill('SIGKILL'), 2000); force.unref(); } };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    const cleanup = () => { clearTimeout(timer); if (force) clearTimeout(force); process.off('SIGINT', stop); process.off('SIGTERM', stop); };
    child.once('error', error => { cleanup(); reject(error); });
    child.once('exit', code => { if (expired || interrupted) kill('SIGKILL'); cleanup(); resolveResult(expired ? 124 : interrupted ? 130 : code ?? 1); });
  }) });
console.log(JSON.stringify({ status: report.status, verification_run_id: report.verification_run_id, report: '.runtime/verification-latest.json',
  steps: report.steps.map(s => ({ id: s.id, status: s.status })), real_supplier: report.real_supplier, real_media: report.real_media }, null, 2));
if (report.status !== 'passed') process.exitCode = 1;
