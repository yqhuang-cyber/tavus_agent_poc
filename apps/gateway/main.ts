import { resolve } from 'node:path';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { PiTutor, fixturePiOptions, livePiOptions } from '../../packages/tutor/runtime.js';
import { TavusClient } from '../../packages/tavus/client.js';
import { ResourceLedger, Resources } from '../../packages/tavus/resources.js';
import { createGateway } from './server.js';
import { readRuntimeConfig } from '../../packages/config/runtime.js';

// Validate before startup recovery can mutate any remote resource.
const config = readRuntimeConfig(process.env);

// Native fetch/SDK fetch must keep the managed environment's proxy and TLS trust.
// EnvHttpProxyAgent also respects NO_PROXY for local development destinations.
if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) {
  setGlobalDispatcher(new EnvHttpProxyAgent());
}

const { modelMode, tavusMode } = config;
const tutor = new PiTutor(modelMode === 'fixture' ? fixturePiOptions() : livePiOptions(process.env));
let resources: Resources | undefined;
if (tavusMode === 'live') {
  if (!process.env.TAVUS_API_KEY || !process.env.TAVUS_FACE_ID || !process.env.GATEWAY_PUBLIC_URL) throw new Error('live_tavus_config_missing');
  const ledger = new ResourceLedger(resolve(process.env.RESOURCE_LEDGER ?? '.runtime/resources.json'));
  await ledger.load(); resources = new Resources(ledger, new TavusClient(process.env.TAVUS_API_KEY));
  // Sessions/credentials are in-memory. Restart closes every previously known room.
  await resources.sweep(Date.now(), true);
  if ([...ledger.records.values()].some(r => !r.palDeleted)) throw new Error('unresolved_resources_reconcile_before_new_sessions');
}
const gateway = createGateway({ operatorToken: config.operatorToken, tutor, modelMode,
  resources, faceId: process.env.TAVUS_FACE_ID, voiceId: process.env.TAVUS_VOICE_ID,
  publicUrl: config.publicUrl });
const { port } = config;
gateway.server.listen(port, config.host, () => {
  console.log(JSON.stringify({ event: 'gateway_listening', port, model_mode: modelMode, tavus_mode: tavusMode }));
});
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (stopping) return; stopping = true;
  const deadline = setTimeout(() => process.exit(1), 25000); deadline.unref();
  void gateway.close().then(() => { clearTimeout(deadline); process.exit(0); }, () => process.exit(1));
});
