import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface VerificationContext { runId: string; runDirectory: string; startedAt: string }
export interface ArtifactEvidence { file: string; sha256: string; counts?: Record<string, number> }
export interface VerificationStep { id: string; command: string[]; validate?: (context: VerificationContext) => Promise<ArtifactEvidence> }
interface StepResult {
  id: string; command: string[]; status: 'not-run' | 'running' | 'passed' | 'failed';
  started_at: string | null; finished_at: string | null; exit_code: number | null;
  error: string | null; artifact: ArtifactEvidence | null;
}
async function atomicJson(path: string, value: unknown) {
  await writeFile(`${path}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 }); await rename(`${path}.tmp`, path);
}
export async function sourceFingerprint(root: string) {
  const hash = createHash('sha256'); const files: string[] = [];
  async function visit(path: string) {
    let entries;
    try { entries = await readdir(join(root, path), { withFileTypes: true }); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
    for (const entry of entries) {
      const relative = join(path, entry.name);
      if (entry.isDirectory()) await visit(relative);
      else if (entry.isFile()) files.push(relative);
      else throw new Error('unsupported_source_entry');
    }
  }
  for (const directory of ['apps', 'packages', 'scripts', 'tests', 'eval', 'docs']) await visit(directory);
  for (const name of ['README.md', 'package.json', 'package-lock.json', 'tsconfig.json', '.env.example']) {
    try { await readFile(join(root, name)); files.push(name); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
  for (const name of files.sort()) { hash.update(name); hash.update('\0'); hash.update(await readFile(join(root, name))); hash.update('\0'); }
  return hash.digest('hex'); // Includes untracked implementation; excludes .env, runtime artifacts and dependencies.
}
export async function freshJsonEvidence(context: VerificationContext, name: string, kind: string, validate: (report: Record<string, unknown>) => boolean) {
  if (!/^[a-z][a-z0-9-]*\.json$/u.test(name)) throw new Error('invalid_report_name');
  const bytes = await readFile(join(context.runDirectory, name)); const report: unknown = JSON.parse(bytes.toString());
  if (!report || typeof report !== 'object' || Array.isArray(report)) throw new Error('invalid_report');
  const r = report as Record<string, unknown>; const time = Date.parse(String(r.timestamp));
  if (r.verification_run_id !== context.runId || r.kind !== kind || !Number.isFinite(time)
    || time < Date.parse(context.startedAt) || time > Date.now() || !validate(r)) throw new Error('invalid_report');
  return { file: name, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export async function runOfflineVerification(options: { root: string; runtimeDirectory: string; steps: VerificationStep[];
  execute: (step: VerificationStep, context: VerificationContext) => Promise<number> }) {
  const runId = `${new Date().toISOString().replaceAll(/[:.]/gu, '-')}-${randomUUID()}`;
  const runDirectory = join(options.runtimeDirectory, 'verification', runId); await mkdir(runDirectory, { recursive: true, mode: 0o700 });
  const context: VerificationContext = { runId, runDirectory, startedAt: new Date().toISOString() };
  const report = { schema_version: 1, verification_run_id: runId, kind: 'offline-verification',
    status: 'running' as 'running' | 'passed' | 'failed', started_at: context.startedAt, finished_at: null as string | null,
    source_fingerprint: { start: null as string | null, end: null as string | null }, error: null as string | null,
    report_directory: runDirectory, real_supplier: 'not-run', real_media: 'not-run', teaching_quality: 'not-evaluated',
    steps: options.steps.map(s => ({ id: s.id, command: s.command, status: 'not-run', started_at: null, finished_at: null,
      exit_code: null, error: null, artifact: null } as StepResult)) };
  const persist = async () => { await atomicJson(join(runDirectory, 'verification.json'), report);
    await atomicJson(join(options.runtimeDirectory, 'verification-latest.json'), report); };
  await persist(); // Invalidate an older green index before any checks run.
  try {
    report.source_fingerprint.start = await sourceFingerprint(options.root);
    for (const [index, step] of options.steps.entries()) {
      const result = report.steps[index]!; result.status = 'running'; result.started_at = new Date().toISOString(); await persist();
      try {
        result.exit_code = await options.execute(step, context);
        if (result.exit_code !== 0) throw new Error('command_failed');
        if (step.validate) {
          try { result.artifact = await step.validate(context); }
          catch { throw new Error('report_invalid_or_missing'); }
        }
        result.status = 'passed';
      } catch (error) {
        result.status = 'failed'; result.error = error instanceof Error && ['command_failed', 'report_invalid_or_missing'].includes(error.message)
          ? error.message : 'command_launch_failed';
      }
      result.finished_at = new Date().toISOString(); await persist();
      if (result.status === 'failed') { report.error = 'step_failed'; break; }
    }
    report.source_fingerprint.end = await sourceFingerprint(options.root);
    if (report.source_fingerprint.start !== report.source_fingerprint.end) report.error = 'source_changed_during_verification';
    if (!options.steps.length) report.error = 'no_checks_configured';
  } catch { report.error = 'verification_runtime_failure'; }
  report.status = report.error ? 'failed' : 'passed'; report.finished_at = new Date().toISOString(); await persist();
  return report;
}
