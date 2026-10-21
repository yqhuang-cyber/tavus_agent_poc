import { mkdir, writeFile } from 'node:fs/promises';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { runtimeChecks } from '../packages/config/runtime.js';
import { TavusClient, TavusError } from '../packages/tavus/client.js';
import { AssetInputError, assetReadiness } from '../packages/tavus/assets.js';
import { inspectLocalMedia } from '../packages/tavus/media-preflight.js';
import { ResourceLedger } from '../packages/tavus/resources.js';

let media: string | undefined; let liveAssets = false; let formalAssets = false;
for (let i = 2; i < process.argv.length; i++) {
  const flag = process.argv[i];
  if (flag === '--media' && !media && process.argv[i + 1] && !process.argv[i + 1]!.startsWith('--')) media = process.argv[++i];
  else if (flag === '--live-assets' && !liveAssets) liveAssets = true;
  else if (flag === '--formal-assets' && !formalAssets) formalAssets = true;
  else throw new Error('usage: preflight [--media local-video.mp4] [--live-assets [--formal-assets]]');
}
if (formalAssets && !liveAssets) throw new Error('formal_assets_requires_explicit_live_assets');
const configuration = runtimeChecks(process.env);
let assets: unknown = { status: 'not-run' }; let mediaReport: unknown = { status: 'not-run' };
let ledgerReport: unknown; let blocked = !configuration.canStart;
try {
  const ledger = new ResourceLedger(process.env.RESOURCE_LEDGER ?? '.runtime/resources.json'); await ledger.load();
  const unresolved = [...ledger.records.values()].filter(r => !r.palDeleted);
  ledgerReport = { status: unresolved.length ? 'needs-reconciliation' : 'clear', unresolvedCount: unresolved.length,
    unknownCount: unresolved.filter(r => r.outcomeUnknown || r.pending).length };
  if (unresolved.length) blocked = true;
} catch { ledgerReport = { status: 'invalid-or-unreadable' }; blocked = true; }
if (media) {
  try { const report = await inspectLocalMedia(media); mediaReport = report; if (!report.metadataEligible) blocked = true; }
  catch { mediaReport = { status: 'local-media-check-failed' }; blocked = true; }
}
if (liveAssets) {
  const key = process.env.TAVUS_API_KEY?.trim(); const faceId = process.env.TAVUS_FACE_ID?.trim();
  const voiceId = process.env.TAVUS_VOICE_ID?.trim() || undefined;
  if (!key || !faceId) { assets = { status: 'missing-key-or-face-id' }; blocked = true; }
  else {
    if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) setGlobalDispatcher(new EnvHttpProxyAgent());
    try {
      const report = await assetReadiness(new TavusClient(key), faceId, voiceId);
      const requirementPassed = formalAssets ? report.formalPhoenix45TrainingComplete : report.technicallyAvailable;
      assets = { ...report, requirement: formalAssets ? 'formal-phoenix-4.5-training' : 'technical-availability', requirementPassed };
      if (!requirementPassed) blocked = true;
    } catch (error) {
      assets = { status: error instanceof AssetInputError ? 'invalid-asset-id' : 'asset-get-failed',
        httpStatus: error instanceof TavusError ? error.status ?? null : null,
        failureCode: error instanceof TavusError ? error.failureCode : error instanceof AssetInputError ? 'invalid_asset_id' : 'asset_check_failure' };
      blocked = true;
    }
  }
}
const report = { timestamp: new Date().toISOString(), kind: 'readiness-preflight', status: blocked ? 'blocked' : 'checks-passed',
  configuration, resources: ledgerReport, localMedia: mediaReport, assets, modelConnectivity: 'not-run', gatewayReachability: 'not-run',
  realConversation: 'not-run', brandApproval: 'not-evaluated', resourceMutations: 0 };
await mkdir('.runtime', { recursive: true, mode: 0o700 });
await writeFile('.runtime/preflight.json', JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
if (blocked) process.exitCode = 1;
