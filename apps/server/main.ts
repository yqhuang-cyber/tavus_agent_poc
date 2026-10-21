import { resolve } from 'node:path';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { readRuntimeConfig } from '../../packages/config/runtime.js';
import { PiTutor, fixturePiOptions, livePiOptions } from '../../packages/tutor/runtime.js';
import { TavusClient } from '../../packages/tavus/client.js';
import { loadNativeSigningSeed, nativeConfiguration } from '../../packages/tavus/native-config.js';
import { NativeResources } from '../../packages/tavus/native-resources.js';
import { ResourceLedger, Resources } from '../../packages/tavus/resources.js';
import { createNativeServer } from './server.js';

const runtime = readRuntimeConfig(process.env);
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) setGlobalDispatcher(new EnvHttpProxyAgent());
const configuration = nativeConfiguration({ operatorToken: runtime.operatorToken, signingSeed: await loadNativeSigningSeed(resolve('.runtime/native-signing-seed')),
  publicUrl: runtime.publicUrl ?? 'https://offline.invalid',
  faceId: process.env.TAVUS_FACE_ID?.trim() || 'offline-face', voiceId: process.env.TAVUS_VOICE_ID?.trim() || undefined });
let resources: NativeResources | undefined;
if (runtime.tavusMode === 'live') {
  const api = new TavusClient(process.env.TAVUS_API_KEY!.trim());
  // Retire rooms from the old probe without touching shared PAL/Tools from the native route.
  const legacy = new ResourceLedger(resolve(process.env.RESOURCE_LEDGER ?? '.runtime/resources.json')); await legacy.load();
  await new Resources(legacy, api).sweep(Date.now(), true);
  if ([...legacy.records.values()].some(r => !r.palDeleted)) throw new Error('legacy_resources_require_reconciliation');
  resources = new NativeResources(resolve('.runtime/native-resources.json'), api, configuration); await resources.load(); await resources.recover();
}
const tutor = new PiTutor({ ...(runtime.modelMode === 'live' ? livePiOptions(process.env) : fixturePiOptions()), decisionMs: 1800 });
const app = await createNativeServer({ operatorToken: runtime.operatorToken, modelMode: runtime.modelMode, tutor, resources, configuration });
app.server.listen(runtime.port, runtime.host, () => console.log(JSON.stringify({ event: 'native_poc_listening', pipeline: 'native',
  url: `http://${runtime.host}:${runtime.port}`, model_mode: runtime.modelMode, tavus_mode: runtime.tavusMode })));
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (stopping) return; stopping = true; const deadline = setTimeout(() => process.exit(1), 25000); deadline.unref();
  void app.close().then(() => { clearTimeout(deadline); process.exit(0); }, () => process.exit(1));
});
