import { mkdir, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export function offlineReportDirectory() { return resolve(process.env.ASKKAI_OFFLINE_REPORT_DIR ?? '.runtime'); }
export async function writeOfflineReport(name: string, report: Record<string, unknown>) {
  if (!/^[a-z][a-z0-9-]*\.json$/u.test(name)) throw new Error('invalid_report_name');
  const directory = offlineReportDirectory(); await mkdir(directory, { recursive: true, mode: 0o700 });
  const value = { ...report, verification_run_id: process.env.ASKKAI_OFFLINE_RUN_ID ?? null };
  const path = resolve(directory, name);
  await writeFile(`${path}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 }); await rename(`${path}.tmp`, path);
  return path;
}
