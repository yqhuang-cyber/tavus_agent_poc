import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { isHttpsBaseUrl, readRuntimeConfig, runtimeChecks } from '../packages/config/runtime.js';
import { assetReadiness } from '../packages/tavus/assets.js';
import { TavusClient, TavusError } from '../packages/tavus/client.js';
import { assessMediaMetadata, inspectLocalMedia } from '../packages/tavus/media-preflight.js';

const run = promisify(execFile);
const syntheticToken = 'synthetic-offline-operator-credential-12345678';
const fixtureEnv = { MODEL_MODE: 'fixture', TAVUS_MODE: 'offline', OPERATOR_TOKEN: syntheticToken };

test('configuration preflight distinguishes syntax from connectivity and never echoes credential values', () => {
  const offline = runtimeChecks(fixtureEnv); assert.equal(offline.canStart, true);
  assert.equal(offline.connectivity, 'not-run'); assert.equal(offline.modelEndpointContract, 'unverified');
  assert.equal(readRuntimeConfig({ ...fixtureEnv, GATEWAY_PUBLIC_URL: '' }).publicUrl, undefined);
  assert.doesNotMatch(JSON.stringify(offline), /synthetic-offline-operator/);
  assert.equal(runtimeChecks({ ...fixtureEnv, OPERATOR_TOKEN: 'replace-with-at-least-32-random-characters' }).canStart, false);
  for (const PORT of ['0', '-1', '65536', 'NaN', '8787.5']) assert.equal(runtimeChecks({ ...fixtureEnv, PORT }).canStart, false);
  const live = { ...fixtureEnv, MODEL_MODE: 'live', TAVUS_MODE: 'live', PI_MODEL_ID: 'tavus-gemma-4',
    PI_MODEL_BASE_URL: 'https://model.example/v1', PI_MODEL_API_KEY: 'MODEL-SECRET', TAVUS_API_KEY: 'TAVUS-SECRET',
    TAVUS_FACE_ID: 'face-approved', GATEWAY_PUBLIC_URL: 'https://gateway.example/' };
  assert.equal(runtimeChecks(live).canStart, true);
  assert.equal(readRuntimeConfig(live).publicUrl, 'https://gateway.example');
  assert.equal(runtimeChecks({ ...live, MODEL_MODE: 'fixture' }).canStart, false);
  assert.equal(runtimeChecks({ ...live, PI_MODEL_API_KEY: '' }).canStart, false);
  assert.throws(() => readRuntimeConfig({ ...live, PI_MODEL_BASE_URL: 'https://u:MODEL-SECRET@model.example' }), e =>
    e instanceof Error && e.message.includes('model_https_base_url') && !e.message.includes('MODEL-SECRET'));
});

test('HTTPS service bases reject credentials, query tokens and fragments before calls', () => {
  for (const value of [undefined, '', 'bad', 'http://model.example', 'https://u:p@model.example',
    'https://model.example?key=secret', 'https://model.example/#secret']) assert.equal(isHttpsBaseUrl(value), false);
  assert.equal(isHttpsBaseUrl('https://model.example/v1'), true);
});

function assetApi(faceOverrides: Record<string, unknown> = {}, voiceOverrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  return { calls, api: {
    getFace: async (id: string) => { calls.push(`face:${id}`); return { face_id: 'face-1', default_voice_id: 'voice-1',
      status: 'completed', finetune_status: 'completed', model_name: 'phoenix-4.5',
      error_message: 'PRIVATE-ERROR', training_video_url: 'PRIVATE-VIDEO-URL', ...faceOverrides }; },
    getVoice: async (id: string) => { calls.push(`voice:${id}`); return { voice_id: id, status: 'completed',
      name: 'PRIVATE-NAME', preview_url: 'PRIVATE-VOICE-URL', ...voiceOverrides }; },
  } };
}

test('GET asset readiness checks Face plus resolved Voice without claiming brand or Chinese quality', async () => {
  const f = assetApi(); const report = await assetReadiness(f.api, 'face-1');
  assert.deepEqual(f.calls, ['face:face-1', 'voice:voice-1']); assert.equal(report.formalPhoenix45TrainingComplete, true);
  assert.equal(report.brandApproval, 'not-evaluated'); assert.equal(report.chineseVoiceQuality, 'not-evaluated');
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE/);
  const g = assetApi(); const selected = await assetReadiness(g.api, 'face-1', 'voice-approved');
  assert.deepEqual(g.calls, ['face:face-1', 'voice:voice-approved']); assert.equal(selected.voice.selection, 'explicit');
});

test('callback ready, pending fine-tuning, error and mismatched assets cannot pass formal readiness', async () => {
  for (const overrides of [{ status: 'ready' }, { status: 'started' }, { status: 'error' },
    { finetune_status: null }, { finetune_status: 'started' }, { finetune_status: 'errored' },
    { model_name: 'phoenix-4' }, { default_voice_id: null }, { face_id: 'different' }]) {
    const f = assetApi(overrides); const report = await assetReadiness(f.api, 'face-1');
    assert.equal(report.formalPhoenix45TrainingComplete, false, JSON.stringify(overrides));
    if (overrides.face_id) assert.equal(f.calls.length, 1);
  }
  for (const voice of [{ status: 'started' }, { status: 'error' }, { voice_id: 'different' }]) {
    assert.equal((await assetReadiness(assetApi({}, voice).api, 'face-1')).technicallyAvailable, false);
  }
});

test('asset REST methods only GET encoded Face and Voice IDs', async () => {
  const calls: string[] = [];
  const client = new TavusClient('synthetic-key', async (url, init) => {
    assert.equal(init?.method, 'GET'); assert.equal(init?.redirect, 'error');
    calls.push(String(url)); return Response.json({});
  });
  await client.getFace('f/1'); await client.getVoice('v/1');
  assert.deepEqual(calls, ['https://tavusapi.com/v2/faces/f%2F1', 'https://tavusapi.com/v2/voices/v%2F1']);
});

const video = { codec_type: 'video', width: 1920, height: 1080, avg_frame_rate: '25/1', duration: '60.0' };
const audio = { codec_type: 'audio', sample_rate: '48000', channels: 1 };

test('local metadata accepts HD 25fps 60 seconds plus audio but leaves speaking/still and brand review open', () => {
  const report = assessMediaMetadata({ streams: [video, audio] }); assert.equal(report.metadataEligible, true);
  assert.equal(report.uploaded, false); assert.equal(report.trainingAccepted, 'not-verified');
  assert.ok(report.manualReview.every(c => c.status === 'not-run'));
  assert.equal(assessMediaMetadata({ streams: [{ ...video, width: 1080, height: 1920 }, audio] }).metadataEligible, true);
  assert.equal(assessMediaMetadata({ streams: [{ ...video, avg_frame_rate: '0/0', r_frame_rate: '25/1' }, audio] }).metadataEligible, true);
});

test('media preflight rejects low or ambiguous metadata and never uses long container audio as video duration', () => {
  for (const v of [{ width: 1280, height: 720 }, { avg_frame_rate: '24000/1001', r_frame_rate: '30/1' }, { duration: '59.99' }]) {
    assert.equal(assessMediaMetadata({ streams: [{ ...video, ...v }, audio] }).metadataEligible, false);
  }
  assert.equal(assessMediaMetadata({ streams: [video] }).metadataEligible, false);
  assert.equal(assessMediaMetadata({ streams: [video, video, audio] }).metadataEligible, false);
  const noDuration = { ...video, duration: undefined };
  const report = assessMediaMetadata({ streams: [noDuration, audio], format: { duration: '120' } });
  assert.equal(report.video.durationSeconds, null); assert.equal(report.metadataEligible, false);
  assert.equal(assessMediaMetadata({ streams: [{ ...noDuration, nb_frames: '1500' }, audio] }).video.durationSource, 'video-frame-count');
  const cover = { ...video, disposition: { attached_pic: 1 } };
  assert.equal(assessMediaMetadata({ streams: [cover, audio] }).metadataEligible, false);
});

test('local media inspector refuses remote URLs and hides ffprobe errors or file paths', async () => {
  await assert.rejects(inspectLocalMedia('https://media.example/private.mp4'), /local_video_file_required/);
  await assert.rejects(inspectLocalMedia('file:///tmp/private.mp4'), /local_video_file_required/);
  await assert.rejects(inspectLocalMedia('/tmp/PRIVATE-NAME-does-not-exist.mp4'), e =>
    e instanceof Error && e.message === 'local_media_probe_failed');
});

test('real ffprobe inspects a local synthetic video and hashes its content without uploading', async t => {
  try { await run('ffmpeg', ['-version']); await run('ffprobe', ['-version']); }
  catch { t.skip('local ffmpeg/ffprobe unavailable'); return; }
  const dir = await mkdtemp(join(tmpdir(), 'askkai-media-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'synthetic-only.mp4');
  await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=1920x1080:r=25:d=1',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1', '-c:v', 'libx264', '-preset', 'ultrafast',
    '-threads', '2', '-c:a', 'aac', '-shortest', '-y', path], { timeout: 20000 });
  const report = await inspectLocalMedia(path);
  assert.equal(report.video.width, 1920); assert.equal(report.video.averageFps, 25); assert.equal(report.audio.present, true);
  assert.equal(report.metadataEligible, false); // One second is deliberately too short for training.
  assert.equal(report.checks.find(c => c.code === 'video_at_least_60_seconds')?.status, 'failed');
  assert.match(report.source.sha256, /^[a-f0-9]{64}$/u); assert.ok(report.source.bytes > 0);
  assert.doesNotMatch(JSON.stringify(report), /synthetic-only|askkai-media/);
});

const script = resolve('scripts/preflight.ts'); const tsx = resolve('node_modules/tsx/dist/loader.mjs');
async function cli(dir: string, envOverrides: NodeJS.ProcessEnv = {}, args: string[] = [], preload?: string) {
  // Preserve inherited managed proxy/TLS settings. Only synthetic child configuration changes.
  const env: NodeJS.ProcessEnv = { ...process.env, ...fixtureEnv, TAVUS_API_KEY: '', TAVUS_FACE_ID: '', RESOURCE_LEDGER: join(dir, 'resources.json'), ...envOverrides };
  delete env.NODE_TEST_CONTEXT; // Child is a CLI, not a test-runner IPC worker.
  let exitCode = 0;
  try { await run(process.execPath, ['--import', tsx, ...(preload ? ['--import', preload] : []), script, ...args], { cwd: dir, env }); }
  catch (error) {
    const result = error as { code: number };
    if (result.code !== 1) throw error;
    exitCode = result.code;
  }
  const data = await readFile(join(dir, '.runtime/preflight.json'), 'utf8');
  return { report: JSON.parse(data), data, exitCode };
}

test('default preflight makes no live asset call, exposes no secrets and records explicit unrun gates', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'askkai-preflight-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const output = await cli(dir, { TAVUS_API_KEY: 'SECRET-NEVER-USED', TAVUS_FACE_ID: 'FACE-NEVER-USED' });
  const report = output.report; assert.equal(output.exitCode, 0); assert.equal(report.status, 'checks-passed');
  assert.equal(report.assets.status, 'not-run'); assert.equal(report.modelConnectivity, 'not-run');
  assert.equal(report.realConversation, 'not-run'); assert.equal(report.resourceMutations, 0);
  assert.doesNotMatch(output.data, /SECRET-NEVER-USED|FACE-NEVER-USED|synthetic-offline-operator/);
  assert.deepEqual(JSON.parse(await readFile(join(dir, '.runtime/preflight.json'), 'utf8')), report);
});

test('preflight reports pending resources read-only and blocks missing live asset credentials without creating anything', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'askkai-preflight-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'resources.json');
  const data = JSON.stringify([{ sessionId: 's1', expiresAt: 1, pending: 'conversation', palId: 'p1',
    closing: false, remoteEnded: false, palDeleted: false, cleanupAttempts: 0 }]);
  await writeFile(path, data);
  const result = await cli(dir, {}, ['--live-assets']); const report = result.report; assert.equal(result.exitCode, 1);
  assert.equal(report.status, 'blocked'); assert.equal(report.resources.unresolvedCount, 1); assert.equal(report.resources.unknownCount, 1);
  assert.equal(report.assets.status, 'missing-key-or-face-id'); assert.equal(await readFile(path, 'utf8'), data);
});

test('preflight includes unresolved native setup without mutating its ledger or contacting the supplier', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'askkai-native-preflight-')); t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, '.runtime'));
  const file = join(dir, '.runtime/native-resources.json'); const bytes = JSON.stringify({ version: 1,
    configs: [{ hash: 'a'.repeat(64), toolIds: [], pending: 'tool', unknown: false }], rooms: [] });
  await writeFile(file, bytes);
  const out = await cli(dir, { TAVUS_API_KEY: 'SECRET-NOT-USED' });
  assert.equal(out.exitCode, 1); assert.equal(out.report.resources.nativeUnknownCount, 1);
  assert.equal(out.report.assets.status, 'not-run'); assert.equal(out.report.resourceMutations, 0);
  assert.equal(await readFile(file, 'utf8'), bytes); assert.doesNotMatch(out.data, /SECRET-NOT-USED/);
});

async function simulatedAssets(dir: string, scenario: Record<string, unknown> = {}) {
  const preload = join(dir, 'asset-transport.mjs'); const callsFile = join(dir, 'calls.json');
  await writeFile(callsFile, '[]');
  // This replaces fetch entirely, including with inherited proxy variables; no request can leave the test.
  await writeFile(preload, `
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
const scenario = ${JSON.stringify(scenario)}; const calls = [];
globalThis.fetch = async (url, init) => {
  const path = new URL(url).pathname;
  calls.push(path); writeFileSync(${JSON.stringify(callsFile)}, JSON.stringify(calls));
  assert.equal(new URL(url).origin, 'https://tavusapi.com'); assert.equal(init.method, 'GET');
  assert.equal(init.headers['x-api-key'], 'PRIVATE-KEY');
  if (scenario.httpStatus) return new Response('PRIVATE-RESPONSE', { status: scenario.httpStatus });
  if (scenario.malformed) return new Response('PRIVATE-MALFORMED', { status: 200 });
  if (scenario.code || scenario.name) {
    const cause = Object.assign(new Error('PRIVATE-CAUSE'), { code: scenario.code });
    const error = new Error('PRIVATE-KEY PRIVATE-URL', { cause });
    if (scenario.name) error.name = scenario.name;
    throw error;
  }
  if (path.startsWith('/v2/faces/')) return Response.json({ face_id: 'face-1', default_voice_id: 'voice-1',
    status: 'completed', model_name: 'phoenix-4', finetune_status: null, ...scenario.face });
  assert.ok(path.startsWith('/v2/voices/'));
  return Response.json({ voice_id: decodeURIComponent(path.split('/').at(-1)), status: 'completed', ...scenario.voice });
};
`);
  return { preload, calls: async () => JSON.parse(await readFile(callsFile, 'utf8')) as string[] };
}
const assetEnv = { TAVUS_API_KEY: ' PRIVATE-KEY ', TAVUS_FACE_ID: ' face-1 ', TAVUS_VOICE_ID: '' };

test('CLI empty or whitespace Voice uses the Face default instead of failing before any HTTP request', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'askkai-assets-')); t.after(() => rm(dir, { recursive: true, force: true }));
  for (const TAVUS_VOICE_ID of ['', '   ', undefined]) {
    const sim = await simulatedAssets(dir);
    const out = await cli(dir, { ...assetEnv, TAVUS_VOICE_ID }, ['--live-assets'], sim.preload);
    assert.equal(out.exitCode, 0); assert.equal(out.report.status, 'checks-passed');
    assert.equal(out.report.assets.voice.selection, 'face-default'); assert.equal(out.report.assets.requirementPassed, true);
    assert.equal(out.report.assets.formalPhoenix45TrainingComplete, false);
    assert.equal(out.report.brandApproval, 'not-evaluated'); assert.equal(out.report.realConversation, 'not-run');
    assert.equal(out.report.resourceMutations, 0); assert.doesNotMatch(out.data, /PRIVATE/);
    assert.deepEqual(await sim.calls(), ['/v2/faces/face-1', '/v2/voices/voice-1']);
  }
});

test('CLI explicit Voice overrides the default while unavailable or missing voices still block technical checks', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'askkai-assets-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const sim = await simulatedAssets(dir);
  const out = await cli(dir, { ...assetEnv, TAVUS_VOICE_ID: ' selected-voice ' }, ['--live-assets'], sim.preload);
  assert.equal(out.exitCode, 0); assert.equal(out.report.assets.voice.selection, 'explicit');
  assert.deepEqual(await sim.calls(), ['/v2/faces/face-1', '/v2/voices/selected-voice']);
  for (const scenario of [{ voice: { status: 'started' } }, { face: { status: 'started' } }, { face: { default_voice_id: null } }]) {
    const failed = await simulatedAssets(dir, scenario); const blocked = await cli(dir, assetEnv, ['--live-assets'], failed.preload);
    assert.equal(blocked.exitCode, 1); assert.equal(blocked.report.assets.requirementPassed, false);
  }
});

test('CLI formal training gate is separate from stock-asset technical availability and does not assert brand approval', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'askkai-assets-')); t.after(() => rm(dir, { recursive: true, force: true }));
  for (const complete of [false, true]) {
    const sim = await simulatedAssets(dir, { face: { model_name: 'phoenix-4.5', finetune_status: complete ? 'completed' : 'started' } });
    const out = await cli(dir, assetEnv, ['--live-assets', '--formal-assets'], sim.preload);
    assert.equal(out.exitCode, complete ? 0 : 1); assert.equal(out.report.assets.requirement, 'formal-phoenix-4.5-training');
    assert.equal(out.report.assets.requirementPassed, complete); assert.equal(out.report.brandApproval, 'not-evaluated');
  }
});

test('CLI invalid IDs are reported as local validation failures without an HTTP request', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'askkai-assets-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const sim = await simulatedAssets(dir);
  const out = await cli(dir, { ...assetEnv, TAVUS_VOICE_ID: 'v'.repeat(257) }, ['--live-assets'], sim.preload);
  assert.equal(out.exitCode, 1); assert.deepEqual(await sim.calls(), []);
  assert.deepEqual(out.report.assets, { status: 'invalid-asset-id', httpStatus: null, failureCode: 'invalid_asset_id' });
});

test('CLI distinguishes HTTP, transport and malformed responses without exposing raw errors or credentials', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'askkai-assets-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const cases = [
    { scenario: { httpStatus: 401 }, code: 'http', http: 401 },
    { scenario: { httpStatus: 404 }, code: 'http', http: 404 },
    { scenario: { code: 'ENOTFOUND' }, code: 'dns', http: null },
    { scenario: { code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' }, code: 'tls', http: null },
    { scenario: { code: 'ECONNRESET' }, code: 'connection', http: null },
    { scenario: { name: 'TimeoutError' }, code: 'timeout', http: null },
    { scenario: { code: 'PRIVATE-UNLISTED-CODE' }, code: 'transport', http: null },
    { scenario: { malformed: true }, code: 'invalid_response', http: 200 },
  ];
  for (const c of cases) {
    const sim = await simulatedAssets(dir, c.scenario);
    const out = await cli(dir, assetEnv, ['--live-assets'], sim.preload);
    assert.equal(out.exitCode, 1); assert.equal(out.report.assets.failureCode, c.code);
    assert.equal(out.report.assets.httpStatus, c.http); assert.doesNotMatch(out.data, /PRIVATE/);
    assert.deepEqual(await sim.calls(), ['/v2/faces/face-1']);
  }
});

test('formal asset checking alone cannot enable network access or create a preflight report', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'askkai-assets-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const sim = await simulatedAssets(dir); const env: NodeJS.ProcessEnv = { ...process.env, ...fixtureEnv, ...assetEnv }; delete env.NODE_TEST_CONTEXT;
  await assert.rejects(run(process.execPath, ['--import', tsx, '--import', sim.preload, script, '--formal-assets'], { cwd: dir, env }), error => {
    assert.match((error as { stderr: string }).stderr, /formal_assets_requires_explicit_live_assets/); return true;
  });
  assert.deepEqual(await sim.calls(), []); await assert.rejects(readFile(join(dir, '.runtime/preflight.json')), { code: 'ENOENT' });
});

test('safe transport diagnostics preserve unknown create outcomes and never retry or retain raw causes', async () => {
  let attempts = 0;
  const client = new TavusClient('PRIVATE-KEY', async () => {
    attempts++; throw new TypeError('PRIVATE-URL', { cause: Object.assign(new Error('PRIVATE-CAUSE'), { code: 'ENOTFOUND' }) });
  });
  await assert.rejects(client.createPal({}), error => {
    assert.ok(error instanceof TavusError); assert.equal(error.failureCode, 'dns'); assert.equal(error.outcomeUnknown, true);
    assert.equal(error.status, undefined); assert.doesNotMatch(JSON.stringify(error), /PRIVATE/); assert.equal(error.cause, undefined); return true;
  });
  assert.equal(attempts, 1);
});

test('invalid startup configuration fails before ledger recovery or remote mutation', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'askkai-startup-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'resources.json'); await mkdir(join(dir, '.runtime'));
  const data = JSON.stringify([{ sessionId: 's1', expiresAt: 1, palId: 'p1', closing: true,
    remoteEnded: false, palDeleted: false, cleanupAttempts: 0 }]); await writeFile(path, data);
  const env: NodeJS.ProcessEnv = { ...process.env, MODEL_MODE: 'live', TAVUS_MODE: 'live', OPERATOR_TOKEN: '',
    PI_MODEL_ID: 'synthetic-only', PI_MODEL_BASE_URL: 'https://model.invalid/v1', PI_MODEL_API_KEY: 'SECRET-MODEL',
    TAVUS_API_KEY: 'SECRET-TAVUS', TAVUS_FACE_ID: 'face', GATEWAY_PUBLIC_URL: 'https://gateway.invalid', RESOURCE_LEDGER: path };
  delete env.NODE_TEST_CONTEXT;
  await assert.rejects(run(process.execPath, ['--import', tsx, resolve('apps/gateway/main.ts')], {
    cwd: dir, env, timeout: 5000,
  }), error => {
    const result = error as { stderr: string }; assert.match(result.stderr, /invalid_runtime_config:operator_token_format/);
    assert.doesNotMatch(result.stderr, /SECRET-MODEL|SECRET-TAVUS/); return true;
  });
  assert.equal(await readFile(path, 'utf8'), data);
});
