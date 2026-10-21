export function isHttpsBaseUrl(value: string | undefined): boolean {
  if (!value) return false;
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash; }
  catch { return false; }
}

export function runtimeChecks(env: NodeJS.ProcessEnv) {
  const modelMode = env.MODEL_MODE ?? 'fixture'; const tavusMode = env.TAVUS_MODE ?? 'offline';
  const port = Number(env.PORT ?? 8787);
  const checks: { code: string; status: 'passed' | 'failed' | 'not_required' }[] = [];
  const add = (code: string, valid: boolean, required = true) => checks.push({ code, status: required ? valid ? 'passed' : 'failed' : 'not_required' });
  add('valid_runtime_modes', ['fixture', 'live'].includes(modelMode) && ['offline', 'live'].includes(tavusMode));
  add('operator_token_format', (env.OPERATOR_TOKEN?.length ?? 0) >= 32 && !env.OPERATOR_TOKEN!.startsWith('replace-'));
  add('valid_port', Number.isInteger(port) && port > 0 && port <= 65535);
  add('live_tavus_requires_live_pi', modelMode === 'live', tavusMode === 'live');
  add('model_id_configured', !!env.PI_MODEL_ID?.trim(), modelMode === 'live');
  add('model_key_configured', !!env.PI_MODEL_API_KEY?.trim(), modelMode === 'live');
  add('model_https_base_url', isHttpsBaseUrl(env.PI_MODEL_BASE_URL), modelMode === 'live');
  add('tavus_key_configured', !!env.TAVUS_API_KEY?.trim(), tavusMode === 'live');
  add('face_id_configured', !!env.TAVUS_FACE_ID?.trim(), tavusMode === 'live');
  add('gateway_https_base_url', isHttpsBaseUrl(env.GATEWAY_PUBLIC_URL), tavusMode === 'live');
  return { kind: 'configuration-syntax-only' as const, canStart: checks.every(c => c.status !== 'failed'), checks,
    connectivity: 'not-run' as const, modelEndpointContract: 'unverified' as const };
}

export function readRuntimeConfig(env: NodeJS.ProcessEnv) {
  const report = runtimeChecks(env);
  if (!report.canStart) throw new Error(`invalid_runtime_config:${report.checks.filter(c => c.status === 'failed').map(c => c.code).join(',')}`);
  return { modelMode: (env.MODEL_MODE ?? 'fixture') as 'fixture' | 'live', tavusMode: (env.TAVUS_MODE ?? 'offline') as 'offline' | 'live',
    operatorToken: env.OPERATOR_TOKEN!, port: Number(env.PORT ?? 8787), host: env.HOST ?? '127.0.0.1',
    publicUrl: env.GATEWAY_PUBLIC_URL?.replace(/\/$/, '') };
}
