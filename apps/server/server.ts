import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { NativeSessions, type NativeSession } from './session.js';
import { NativeHooks } from './hooks.js';
import { HttpError } from '../gateway/state.js';
import { TavusError } from '../../packages/tavus/client.js';
import type { Tutor } from '../../packages/tutor/runtime.js';
import type { NativeResources } from '../../packages/tavus/native-resources.js';
import type { NativeConfiguration } from '../../packages/tavus/native-config.js';

interface Options { operatorToken: string; modelMode: 'fixture' | 'live'; tutor: Tutor; resources?: NativeResources;
  configuration: NativeConfiguration; runtimeDirectory?: string; webDirectory?: string; planMs?: number }
const header = (req: IncomingMessage, name: string) => typeof req.headers[name] === 'string' ? req.headers[name] as string : undefined;
const nativeCodes = new Set(['native_resources_require_reconciliation', 'native_room_limit', 'native_ledger_capacity', 'native_configuration_limit',
  'native_start_cancelled', 'native_join_credentials_missing', 'native_pal_config_mismatch', 'native_tools_not_attached']);
function equal(a: string, b: string) { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
async function rawBody(req: IncomingMessage) {
  if (!header(req, 'content-type')?.startsWith('application/json')) throw new HttpError(415, 'json_required');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 65536) throw new HttpError(413, 'body_too_large'); chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks);
}
function object(raw: Buffer): Record<string, unknown> {
  let o: unknown; try { o = JSON.parse(raw.toString()); } catch { throw new HttpError(400, 'invalid_json'); }
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new HttpError(400, 'json_object_required'); return o as Record<string, unknown>;
}
const json = (res: ServerResponse, status: number, value: unknown) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };

export async function createNativeServer(options: Options) {
  if (options.operatorToken.length < 32 || options.operatorToken.startsWith('replace-')) throw new Error('operator_token_requires_32_characters');
  if (options.resources && options.modelMode !== 'live') throw new Error('live_native_requires_live_pi');
  const root = options.webDirectory ?? resolve('apps/web');
  const bundle = await build({ entryPoints: [resolve(root, 'app.ts')], bundle: true, write: false, platform: 'browser', format: 'esm', target: ['es2022'], minify: true });
  const html = await readFile(resolve(root, 'index.html')); const css = await readFile(resolve(root, 'style.css'));
  const sessions = new NativeSessions(options.tutor, options.modelMode, Date.now, options.planMs);
  const hooks = new NativeHooks(sessions, options.configuration, resolve(options.runtimeDirectory ?? '.runtime', 'native-jobs.json')); await hooks.load();
  const owners = new Map<string, { id: string; expires: number }>();
  let shuttingDown = false; let requests = 0; let windowStart = Date.now(); let loginAttempts = 0;
  const closing = new Map<string, Promise<void>>();
  function finish(s: NativeSession, reason: string, closingId?: string): Promise<void> {
    const previous = closing.get(s.id); if (previous) return previous;
    sessions.commitClose(s, reason, closingId); s.cleanup = options.resources ? 'pending' : 'offline/no-remote-resource';
    const task = (async () => {
      if (s.context.saveAllowed) await sessions.save(s);
      const released = await options.resources?.cleanup(s.id).catch(() => false) ?? true;
      s.cleanup = options.resources ? released ? 'remote-ended-confirmed' : 'needs-reconciliation' : 'offline/no-remote-resource';
      s.status = released ? 'closed' : 'closing';
    })();
    closing.set(s.id, task); void task.finally(() => closing.delete(s.id)).catch(() => {}); return task;
  }
  const server = createServer((req, res) => {
    res.setHeader('cache-control', 'no-store'); res.setHeader('x-content-type-options', 'nosniff'); res.setHeader('referrer-policy', 'no-referrer');
    // Daily's call object may delegate microphone capture to its iframe. Keep that delegation intact.
    res.setHeader('permissions-policy', 'camera=()');
    void handle(req, res).catch(e => {
      if (res.destroyed || res.writableEnded) return;
      if (res.headersSent) { res.destroy(); return; }
      const known = e instanceof HttpError; const upstream = e instanceof TavusError;
      const nativeCode = e instanceof Error && nativeCodes.has(e.message) ? e.message : undefined;
      json(res, known ? e.status : 502, { error: { code: known ? e.code : upstream ? 'tavus_request_failed' : nativeCode ?? 'runtime_or_upstream_failure',
        ...(upstream ? { httpStatus: e.status ?? null, failureCode: e.failureCode } : {}) } });
    });
  });
  server.requestTimeout = 15000; server.headersTimeout = 15000;
  function owner(req: IncomingMessage) {
    const cookie = header(req, 'cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith('askkai_operator='))?.slice('askkai_operator='.length);
    const entry = cookie && owners.get(cookie); if (!entry || entry.expires < Date.now()) throw new HttpError(401, 'login_required'); return entry.id;
  }
  function origin(req: IncomingMessage) {
    const value = header(req, 'origin'); const host = header(req, 'host');
    let allowed = false;
    try { const url = new URL(value ?? ''); allowed = (['127.0.0.1', 'localhost'].includes(url.hostname) && url.host === host && url.protocol === 'http:')
      || url.origin === new URL(options.configuration.base).origin; } catch { /* Reject absent or malformed origins. */ }
    if (!allowed) throw new HttpError(403, 'same_origin_required');
  }
  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://local.invalid'); const path = url.pathname;
    if (req.method === 'GET' && path === '/healthz') return json(res, 200, { status: shuttingDown ? 'closing' : 'ok', model_mode: options.modelMode,
      tavus_mode: options.resources ? 'live' : 'offline', pipeline: 'native', web: 'ready' });
    if (req.method === 'GET' && ['/', '/app.js', '/style.css'].includes(path)) {
      const content = path === '/' ? html : path === '/app.js' ? bundle.outputFiles[0]!.contents : css;
      res.writeHead(200, { 'content-type': path === '/' ? 'text/html; charset=utf-8' : path === '/app.js' ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8' }); res.end(content); return;
    }
    if (shuttingDown) throw new HttpError(503, 'shutting_down');
    if (Date.now() - windowStart > 60000) { windowStart = Date.now(); requests = 0; loginAttempts = 0; }
    if (++requests > 1800) throw new HttpError(429, 'request_limit');
    if (req.method === 'POST' && ['/hooks/tavus/tools', '/hooks/tavus/post-call'].includes(path)) {
      const result = await hooks.handle(await rawBody(req), header(req, 'x-tavus-signature'), path.endsWith('post-call'));
      return json(res, path.endsWith('post-call') ? 202 : 200, result);
    }
    if (req.method === 'POST' && path === '/hooks/tavus/conversation') {
      const data = object(await rawBody(req));
      const s = typeof data.conversation_id === 'string' ? sessions.byConversation(data.conversation_id) : undefined;
      // Unauthenticated hints can only trigger bounded GET verification for a known room.
      if (s && options.resources && Date.now() - ((s as NativeSession & { lastHint?: number }).lastHint ?? 0) > 5000) {
        (s as NativeSession & { lastHint?: number }).lastHint = Date.now();
        if (await options.resources.confirmedEnd(s.conversationId!).catch(() => false)) await finish(s, 'provider-ended');
      }
      return json(res, 202, { status: 'notification-only' });
    }
    if (!path.startsWith('/api/')) throw new HttpError(404, 'not_found');
    if (req.method === 'POST') origin(req);
    if (req.method === 'POST' && path === '/api/login') {
      if (++loginAttempts > 20) throw new HttpError(429, 'login_rate_limit');
      const data = object(await rawBody(req)); if (typeof data.token !== 'string' || !equal(data.token, options.operatorToken)) throw new HttpError(401, 'invalid_access_code');
      for (const [key, entry] of owners) if (entry.expires < Date.now()) owners.delete(key);
      if (owners.size >= 16) throw new HttpError(429, 'operator_limit');
      const cookie = randomBytes(32).toString('base64url'); const id = randomBytes(16).toString('hex'); owners.set(cookie, { id, expires: Date.now() + 28800000 });
      const secure = !/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/u.test(header(req, 'host') ?? '');
      res.setHeader('set-cookie', `askkai_operator=${cookie}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure ? '; Secure' : ''}`);
      return json(res, 200, { status: 'ok' });
    }
    const operator = owner(req);
    if (req.method === 'GET' && path === '/api/resources') return json(res, 200, { resources: options.resources?.view() ?? { configs: [], rooms: [] } });
    if (req.method === 'GET' && path === '/api/bootstrap') return json(res, 200, { mode: options.resources ? 'live' : 'offline', pipeline: 'native',
      profiles: ['alex', 'maya', 'leo', 'nina'], current: [...sessions.sessions.values()].filter(s => s.owner === operator && !['closed', 'failed'].includes(s.status)).map(s => sessions.view(s)),
      model: options.modelMode === 'live' ? 'configured/not-yet-verified' : 'synthetic-fixture' });
    if (req.method === 'GET' && path === '/api/records') return json(res, 200, { mode: 'mock-memory', records: sessions.records(operator) });
    if (req.method === 'POST' && path === '/api/sessions') {
      const data = object(await rawBody(req));
      if (typeof data.fixture !== 'string' || typeof data.chineseOnly !== 'boolean' || typeof data.saveAllowed !== 'boolean'
        || Object.keys(data).some(k => !['fixture', 'chineseOnly', 'saveAllowed'].includes(k))) throw new HttpError(400, 'invalid_session_options');
      if ([...sessions.sessions.values()].some(s => s.owner === operator && !['closed', 'failed'].includes(s.status))) throw new HttpError(409, 'existing_session_resume_or_exit');
      const s = sessions.create(operator, data.fixture, data.chineseOnly, data.saveAllowed);
      const disconnected = () => { if (!res.writableEnded) { sessions.cancelPlan(s); void finish(s, 'startup-disconnected'); } };
      res.once('close', disconnected);
      try {
        await sessions.plan(s, 'initial');
        if (!sessions.open(s)) throw new HttpError(409, 'startup_cancelled');
        if (options.resources) {
          const greeting = `你好，${s.context.profile.name}！我是 Kai。今天想聊什么？`;
          const room = await options.resources.create(s.id, s.expiresAt, sessions.context(s), greeting, () => sessions.open(s));
          s.conversationId = room.conversation_id; s.join = { conversation_url: room.conversation_url, meeting_token: room.meeting_token };
        } else s.conversationId = `offline-${s.id}`;
        if (!sessions.open(s)) throw new HttpError(409, 'startup_cancelled');
        s.status = 'joining'; s.lastSeen = Date.now(); return json(res, 201, sessions.view(s));
      } catch (e) { await finish(s, 'startup-failed'); throw e; }
      finally { res.off('close', disconnected); }
    }
    const match = path.match(/^\/api\/sessions\/([^/]+)(?:\/(join|reconnect|ready|heartbeat|event|text|context|context-sent|interrupt|prepare-close|resume|finish|exit|consent|save))?$/u);
    if (!match?.[1]) throw new HttpError(404, 'not_found');
    const s = sessions.get(match[1], operator); const action = match[2];
    if (req.method === 'GET' && !action) return json(res, 200, sessions.view(s));
    if (req.method === 'GET' && action === 'join') {
      if (!sessions.open(s)) throw new HttpError(409, 'session_not_open');
      return json(res, 200, { ...s.join, conversation_id: s.conversationId, epoch: s.epoch, offline: !options.resources });
    }
    if (req.method === 'GET' && action === 'context') {
      if (!sessions.open(s) || Number(url.searchParams.get('version')) !== s.version || s.pending) throw new HttpError(409, 'context_not_current');
      return json(res, 200, { version: s.version, epoch: s.epoch, context: sessions.context(s) });
    }
    if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
    const data = object(await rawBody(req));
    if (data.epoch !== s.epoch) throw new HttpError(409, 'stale_connection_epoch');
    if (action === 'reconnect') sessions.reconnect(s);
    else if (action === 'heartbeat') { if (!sessions.open(s)) throw new HttpError(409, 'session_not_open'); s.lastSeen = Date.now(); }
    else if (action === 'ready') { if (!sessions.open(s) || s.status !== 'joining') throw new HttpError(409, 'session_not_joining'); s.status = 'active'; s.lastSeen = Date.now(); }
    else if (action === 'event') {
      if (!data.event || typeof data.event !== 'object' || Array.isArray(data.event)) throw new HttpError(400, 'invalid_event');
      return json(res, 200, { result: sessions.event(s, data.event as Record<string, unknown>, Number(data.epoch)), session: sessions.view(s) });
    } else if (action === 'text') {
      if (typeof data.text !== 'string' || typeof data.inputId !== 'string') throw new HttpError(400, 'invalid_text_input');
      if (Buffer.byteLength(JSON.stringify({ text: data.text }), 'utf8') > 3000) throw new HttpError(400, 'text_input_too_large');
      const result = sessions.text(s, data.inputId, data.text);
      return json(res, 200, { result, session: sessions.view(s), ...(options.resources ? {} : { offlineReply: `这是离线演示，${s.context.profile.name}。你刚才的表达已进入教学规划。` }) });
    } else if (action === 'context-sent') {
      if (!sessions.open(s) || data.version !== s.version || data.epoch !== s.epoch) throw new HttpError(409, 'stale_context_receipt');
      s.contextSentVersion = s.version; s.contextSendStatus = 'client-reported-sent';
    } else if (action === 'interrupt') { sessions.cancelPlan(s); sessions.resume(s); s.version++; s.contextSendStatus = 'interrupted'; }
    else if (action === 'prepare-close') {
      const closing = await sessions.prepareClose(s, true); s.controlText = '今天我们聊到这里吧，请先回顾一下，然后再见。';
      return json(res, 200, { session: sessions.view(s), closing, controlText: s.controlText });
    } else if (action === 'resume') { if (!sessions.open(s)) throw new HttpError(409, 'session_not_open'); sessions.resume(s); s.version++; }
    else if (action === 'finish') {
      if (typeof data.closingId !== 'string' || data.confirmation !== 'user-confirmed') throw new HttpError(400, 'closing_confirmation_required');
      void finish(s, 'user-confirmed', data.closingId).catch(() => {});
    } else if (action === 'exit') { void finish(s, 'immediate-exit').catch(() => {}); }
    else if (action === 'consent') { if (data.allowed !== false) throw new HttpError(400, 'only_consent_revocation_supported'); sessions.revokeConsent(s); }
    else if (action === 'save') { await sessions.save(s); }
    else throw new HttpError(404, 'not_found');
    return json(res, 200, sessions.view(s));
  }
  let sweeping = false;
  const sweep = setInterval(() => {
    if (sweeping) return; sweeping = true;
    void (async () => {
      for (const s of sessions.sessions.values()) {
        if (sessions.open(s) && (Date.now() - s.lastSeen > 45000 || Date.now() >= s.expiresAt)) await finish(s, 'lease-expired');
        else if (s.expiresAt <= Date.now() && !['closed', 'failed'].includes(s.status)) await finish(s, 'expired');
        else if (s.closing && Date.now() - s.closing.createdAt > 30000 && s.status === 'reviewing') await finish(s, 'review-timeout/unconfirmed-playback');
      }
      await options.resources?.sweep();
      for (const s of sessions.sessions.values()) {
        if (s.status === 'closing' && options.resources?.view().rooms.find(r => r.sessionId === s.id)?.ended) { s.status = 'closed'; s.cleanup = 'remote-ended-confirmed'; }
        if (s.expiresAt + 3600000 < Date.now() && ['closed', 'failed'].includes(s.status)) sessions.sessions.delete(s.id);
      }
    })().catch(() => {}).finally(() => { sweeping = false; });
  }, 5000); sweep.unref();
  return { server, sessions, hooks, async close() {
    shuttingDown = true; clearInterval(sweep);
    await Promise.all([...sessions.sessions.values()].filter(s => !['closed', 'failed'].includes(s.status)).map(s => finish(s, 'shutdown').catch(() => {})));
    if (server.listening) { server.closeIdleConnections(); await new Promise<void>(r => server.close(() => r())); }
  } };
}
