import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { getMockContext } from '../../packages/business/context.js';
import type { Tutor, TutorInput } from '../../packages/tutor/runtime.js';
import { conversationConfig, palConfig } from '../../packages/tavus/client.js';
import type { Resources } from '../../packages/tavus/resources.js';
import { HttpError, parseMessages, Sessions } from './state.js';
import { Summaries } from './summaries.js';
import { EvidenceError, type CloseReason, type InputModality } from '../../packages/evidence/journal.js';
import { guardDecision } from '../../packages/tutor/decision-guard.js';
import { PreparationError, PreparationTickets } from '../../packages/business/preparation.js';
import { isHttpsBaseUrl } from '../../packages/config/runtime.js';
import { timingSummary } from '../../packages/observability/timing.js';
import { LifecycleTimings, type StageOutcome } from '../../packages/observability/lifecycle.js';

export interface GatewayOptions {
  operatorToken: string; tutor: Tutor; modelMode: 'fixture' | 'live'; sessions?: Sessions;
  resources?: Resources; publicUrl?: string; faceId?: string; voiceId?: string;
  summaries?: Summaries;
}
function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}
function header(req: IncomingMessage, name: string) { const v = req.headers[name]; return typeof v === 'string' ? v : undefined; }
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!header(req, 'content-type')?.startsWith('application/json')) throw new HttpError(415, 'json_required');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) throw new HttpError(413, 'body_too_large');
    chunks.push(Buffer.from(chunk));
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new HttpError(400, 'invalid_json'); }
}
async function write(res: ServerResponse, text: string, signal: AbortSignal) {
  signal.throwIfAborted();
  if (res.destroyed || res.writableEnded) throw new Error('stream_closed');
  if (!res.write(text)) await new Promise<void>((resolve, reject) => {
    const cleanup = () => { res.off('drain', drained); res.off('close', closed); signal.removeEventListener('abort', closed); };
    const drained = () => { cleanup(); resolve(); };
    const closed = () => { cleanup(); reject(new Error('stream_closed')); };
    res.once('drain', drained); res.once('close', closed); signal.addEventListener('abort', closed, { once: true });
    if (signal.aborted || res.destroyed) closed();
  });
}

export function createGateway(options: GatewayOptions) {
  if (options.operatorToken.length < 32 || options.operatorToken.startsWith('replace-')) throw new Error('operator_token_requires_32_random_characters');
  if (options.resources && (options.modelMode !== 'live' || !options.faceId || !isHttpsBaseUrl(options.publicUrl))) throw new Error('live_tavus_requires_live_pi_https_and_face');
  const sessions = options.sessions ?? new Sessions();
  const summaries = options.summaries ?? new Summaries();
  const tickets = new PreparationTickets();
  const lifecycle = options.resources?.timings ?? new LifecycleTimings();
  const mockContext = (data: Record<string, unknown>, preparation = false) => {
    if (typeof data.fixture !== 'string' || !['alex', 'maya', 'leo', 'nina'].includes(data.fixture)) throw new HttpError(400, 'unknown_fixture');
    if (Object.keys(data).some(k => !['fixture', 'mock_save_allowed', ...(preparation ? ['chinese_only'] : [])].includes(k))) throw new HttpError(400, 'unsupported_session_options');
    if (data.mock_save_allowed !== undefined && (typeof data.mock_save_allowed !== 'boolean' || options.resources || options.modelMode !== 'fixture')) throw new HttpError(400, 'mock_consent_offline_only');
    if (data.chinese_only !== undefined && typeof data.chinese_only !== 'boolean') throw new HttpError(400, 'invalid_language_preference');
    const context = getMockContext(data.fixture, data.mock_save_allowed === true);
    if (preparation) context.preferences.chineseOnly = data.chinese_only === true;
    return context;
  };
  let shuttingDown = false;
  let callbackWindow = Date.now(); let callbacks = 0;
  const lastHint = new Map<string, number>();
  const preparations = new Map<string, AbortController>();
  const finalize = (s: ReturnType<Sessions['get']>, reason: CloseReason) => summaries.freeze(s, reason);
  const syncClosedSessions = () => {
    for (const s of sessions.all()) {
      const r = options.resources?.ledger.records.get(s.id);
      if (s.status === 'closing' && !preparations.has(s.id) && (!r || (r.palDeleted && (!r.conversationId || r.remoteEnded)))) {
        s.status = 'closed'; sessions.revoke(s);
        finalize(s, 'expired');
      }
    }
  };
  const server = createServer((req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    void handle(req, res).catch(error => {
      if (res.destroyed || res.writableEnded) return;
      if (res.headersSent) { res.destroy(); return; }
      const known = error instanceof HttpError || error instanceof PreparationError;
      json(res, known ? error.status : 502, { error: { code: known ? error.code : 'upstream_or_runtime_failure' } });
    });
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000;

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const path = new URL(req.url ?? '/', 'http://gateway.invalid').pathname;
    if (req.method === 'GET' && path === '/healthz') return json(res, 200, { status: shuttingDown ? 'closing' : 'ok', model_mode: options.modelMode, tavus_mode: options.resources ? 'live' : 'offline' });
    if (shuttingDown) throw new HttpError(503, 'shutting_down');
    if (req.method === 'POST' && path === '/v1/chat/completions') {
      const key = header(req, 'x-askkai-session-key');
      const bearer = header(req, 'authorization')?.replace(/^Bearer /, '');
      if (key && bearer && key !== bearer) throw new HttpError(401, 'credential_mismatch');
      const session = sessions.authenticate(key ?? bearer);
      const data = await body(req);
      const users = parseMessages(data);
      const synthetic = options.modelMode === 'fixture' && !options.resources;
      if (data.input_modality !== undefined && (!synthetic || typeof data.input_modality !== 'string' || !['text', 'audio_transcript', 'unknown'].includes(data.input_modality))) throw new HttpError(400, 'unverified_input_modality');
      const run = sessions.begin(session, users, (data.input_modality ?? 'unknown') as InputModality, synthetic);
      const created = Math.floor(Date.now() / 1000);
      const disconnected = () => { if (!res.writableEnded) sessions.cancel(session, 'sse_disconnected', run.responseId); };
      // Never let an old socket cancel its successor.
      const onClose = () => { if (session.run === run) disconnected(); };
      res.once('close', onClose);
      const onAbort = () => { if (!res.writableEnded) res.destroy(); };
      run.controller.signal.addEventListener('abort', onAbort, { once: true });
      const chunk = (delta: Record<string, unknown>, finish: string | null = null) => `data: ${JSON.stringify({ id: `chatcmpl-${run.responseId}`, object: 'chat.completion.chunk', created, model: 'ask-kai-pi', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
      try {
        const input: TutorInput = { context: structuredClone(session.context), users: [...users], teaching: structuredClone(run.teaching!),
          priorReplies: session.runs.filter(r => r !== run && r.text).map(r => ({ text: r.text, status: r.status, presentation: 'unknown' })) };
        const proposed = await options.tutor.decide(input, run.controller.signal).finally(() => run.timing.mark('decision_finished'));
        if (!sessions.current(session, run)) throw new Error('stale_run');
        const accepted = guardDecision(proposed, run.teaching!, users.at(-1)!);
        run.decision = accepted.decision; run.proposedAction = accepted.proposedAction; run.policyGuards = accepted.guards;
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform',
          'x-accel-buffering': 'no', 'x-askkai-response-id': run.responseId });
        await write(res, chunk({ role: 'assistant' }), run.controller.signal);
        run.timing.mark('generation_started');
        await options.tutor.speak(input, run.decision, run.controller.signal, async text => {
          if (!sessions.current(session, run)) throw new Error('stale_run');
          await write(res, chunk({ content: text }), run.controller.signal);
          if (text.length) run.timing.mark('first_text_forwarded');
          run.text += text; run.forwardedCharacters += text.length;
        }).finally(() => run.timing.mark('generation_finished'));
        if (!sessions.current(session, run)) throw new Error('stale_run');
        await write(res, chunk({}, 'stop'), run.controller.signal);
        await write(res, 'data: [DONE]\n\n', run.controller.signal);
        run.status = 'completed'; res.end();
      } catch (error) {
        if (run.status === 'running') run.status = run.forwardedCharacters ? 'partial' : 'failed';
        run.controller.signal.removeEventListener('abort', onAbort);
        run.controller.abort('response_failed');
        throw error;
      } finally {
        run.timing.mark('execution_finished');
        run.piCancelled = run.controller.signal.aborted;
        run.controller.signal.removeEventListener('abort', onAbort); res.off('close', onClose);
      }
      return;
    }
    if (req.method === 'POST' && path === '/hooks/tavus/conversation') {
      if (Date.now() - callbackWindow > 60000) { callbackWindow = Date.now(); callbacks = 0; }
      if (++callbacks > 30) throw new HttpError(429, 'callback_rate_limit');
      const data = await body(req);
      // Callback timestamp may be ISO. It is not a trusted identity or playback receipt.
      if (typeof data.conversation_id === 'string' && options.resources && Date.now() - (lastHint.get(data.conversation_id) ?? 0) > 5000) {
        const known = [...options.resources.ledger.records.values()].some(r => r.conversationId === data.conversation_id);
        if (known) {
          lastHint.set(data.conversation_id, Date.now());
          await options.resources.callbackHint(data.conversation_id);
          const record = [...options.resources.ledger.records.values()].find(r => r.conversationId === data.conversation_id);
          if (record?.remoteEnded) {
            const session = sessions.all().find(s => s.id === record.sessionId);
            if (session) { session.status = 'closing'; sessions.revoke(session); finalize(session, 'provider_end'); }
            syncClosedSessions();
          }
        }
      }
      return json(res, 202, { status: 'notification_only' });
    }
    if (!path.startsWith('/internal/')) throw new HttpError(404, 'not_found');
    const supplied = Buffer.from(header(req, 'authorization') ?? '');
    const expected = Buffer.from(`Bearer ${options.operatorToken}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new HttpError(401, 'operator_auth_required');
    if (req.method === 'GET' && path === '/internal/metrics') return json(res, 200,
      { ...timingSummary(sessions.all().flatMap(s => s.runs), options.modelMode), lifecycle: lifecycle.view() });
    if (req.method === 'POST' && path === '/internal/preparations') {
      if (options.modelMode !== 'fixture' || options.resources) throw new HttpError(409, 'mock_preparation_offline_only');
      return json(res, 201, tickets.issue(mockContext(await body(req), true), options.operatorToken));
    }
    if (req.method === 'POST' && path === '/internal/sessions') {
      const data = await body(req);
      sessions.expire(); syncClosedSessions();
      sessions.assertCapacity();
      const openResources = [...(options.resources?.ledger.records.values() ?? [])].filter(r => !r.palDeleted);
      if (openResources.some(r => r.outcomeUnknown)) throw new HttpError(409, 'resources_require_reconciliation');
      if (openResources.length >= 2) throw new HttpError(429, 'resource_limit');
      const hasTicket = Object.hasOwn(data, 'preparation_ticket');
      if (hasTicket && (typeof data.preparation_ticket !== 'string' || data.preparation_ticket.length > 256 || Object.keys(data).length !== 1)) throw new HttpError(400, 'ticket_start_requires_ticket_only');
      if (hasTicket && (options.modelMode !== 'fixture' || options.resources)) throw new HttpError(409, 'mock_preparation_offline_only');
      const context = hasTicket ? tickets.redeem(data.preparation_ticket as string, options.operatorToken) : mockContext(data);
      const { session, key } = sessions.create(context);
      if (!options.resources) { session.status = 'active'; return json(res, 201, { ...sessions.diagnostic(session), gateway_credential: key }); }
      const controller = new AbortController(); preparations.set(session.id, controller);
      const abortPreparation = () => {
        if (!['closed', 'failed'].includes(session.status)) session.status = 'closing';
        sessions.revoke(session);
        // Fence in-flight resource creation immediately; waiting for create()
        // to return would permit a room to start after the browser has left.
        void options.resources!.cleanup(session.id).catch(() => {});
      };
      controller.signal.addEventListener('abort', abortPreparation, { once: true });
      res.once('close', () => { if (!res.writableEnded) controller.abort('preparation_disconnected'); });
      const finishStartup = lifecycle.start(session.id, 'startup');
      let startupOutcome: Exclude<StageOutcome, 'running'> = 'failed';
      const greetingFailure = () => controller.signal.aborted ? 'cancelled' as const : 'failed' as const;
      try {
        const input: TutorInput = { context: session.context, users: [], priorReplies: [], greeting: true, teaching: structuredClone(session.teaching) };
        const proposed = await lifecycle.measure(session.id, 'greeting-decision', () => options.tutor.decide(input, controller.signal), greetingFailure);
        controller.signal.throwIfAborted();
        const decision = guardDecision(proposed, session.teaching, '').decision;
        let greeting = '';
        await lifecycle.measure(session.id, 'greeting-generation', () => options.tutor.speak(input, decision, controller.signal,
          async text => { greeting += text; }), greetingFailure);
        controller.signal.throwIfAborted();
        const room = await options.resources.create(session.id, session.expiresAt,
          palConfig(session.id, options.faceId!, options.voiceId, options.publicUrl!, key),
          palId => conversationConfig(session.id, palId, options.faceId!, options.publicUrl!, greeting));
        controller.signal.throwIfAborted();
        session.status = 'joining';
        startupOutcome = 'succeeded';
        return json(res, 201, { ...sessions.diagnostic(session), ...room, model_mode: options.modelMode });
      } catch (error) {
        const resource = options.resources.ledger.records.get(session.id);
        startupOutcome = resource?.outcomeUnknown || resource?.pending ? 'unresolved' : controller.signal.aborted ? 'cancelled' : 'failed';
        if (!['closing', 'closed'].includes(session.status)) session.status = 'failed';
        sessions.revoke(session);
        finalize(session, 'failed');
        await options.resources.cleanup(session.id).catch(() => {});
        throw error;
      } finally {
        finishStartup(startupOutcome);
        controller.signal.removeEventListener('abort', abortPreparation);
        preparations.delete(session.id); syncClosedSessions();
      }
    }
    if (req.method === 'GET' && path === '/internal/resources') return json(res, 200, { resources: [...(options.resources?.ledger.records.values() ?? [])] });
    if (req.method === 'POST' && path === '/internal/resources/cleanup') { await options.resources?.sweep(); return json(res, 200, { status: 'cleanup_attempted' }); }
    const match = path.match(/^\/internal\/sessions\/([^/]+)(?:\/(stop|end|evidence|summary|summary\/save))?$/);
    if (!match?.[1]) throw new HttpError(404, 'not_found');
    const s = sessions.get(match[1]);
    if (req.method === 'GET' && !match[2]) return json(res, 200, sessions.diagnostic(s));
    if (req.method === 'GET' && match[2] === 'evidence') return json(res, 200, s.evidence.inspect());
    if (req.method === 'GET' && match[2] === 'summary') return json(res, 200, summaries.view(s));
    if (req.method === 'POST' && match[2] === 'evidence') {
      const data = await body(req);
      if (!['active', 'joining'].includes(s.status) || data.expected_state_version !== s.stateVersion
        || data.expected_consent_version !== s.context.consentVersion) throw new HttpError(409, 'stale_evidence_submission');
      if (typeof data.kind !== 'string' || !['topic', 'attempt'].includes(data.kind) || typeof data.evidence_id !== 'string' || typeof data.quote !== 'string'
        || Object.keys(data).some(k => !['kind', 'evidence_id', 'quote', 'expected_state_version', 'expected_consent_version'].includes(k))) throw new HttpError(400, 'invalid_evidence_selection');
      try { return json(res, 201, s.evidence.select(data.kind as 'topic' | 'attempt', data.evidence_id, data.quote)); }
      catch (error) { if (error instanceof EvidenceError) throw new HttpError(409, error.message); throw error; }
    }
    if (req.method === 'POST' && match[2] === 'summary/save') {
      const data = await body(req);
      if (typeof data.summary_id !== 'string' || typeof data.expected_consent_version !== 'number') throw new HttpError(400, 'summary_id_and_consent_version_required');
      return json(res, 202, summaries.requestSave(s, data.summary_id, data.expected_consent_version));
    }
    if (req.method === 'POST' && match[2] === 'stop') {
      const data = await body(req);
      if (typeof data.response_id !== 'string') throw new HttpError(400, 'response_id_required');
      sessions.cancel(s, 'manual_stop', data.response_id);
      return json(res, 200, { cancel_status: 'requested', media_stop: 'unknown', ...sessions.diagnostic(s) });
    }
    if (req.method === 'POST' && match[2] === 'end') {
      const data = await body(req);
      if (data.save !== undefined && typeof data.save !== 'boolean') throw new HttpError(400, 'invalid_save_choice');
      if (data.save === true && data.expected_consent_version !== s.context.consentVersion) throw new HttpError(409, 'stale_summary_or_consent');
      s.status = 'closing'; sessions.revoke(s); preparations.get(s.id)?.abort('session_closed');
      const summary = finalize(s, 'user_end');
      if (data.save === true) summaries.requestSave(s, summary.id, s.context.consentVersion);
      await options.resources?.cleanup(s.id).catch(() => {});
      const record = options.resources?.ledger.records.get(s.id);
      if (!record || (record.remoteEnded && record.palDeleted)) s.status = 'closed';
      return json(res, 200, { ...sessions.diagnostic(s), summary: summaries.view(s) });
    }
    throw new HttpError(404, 'not_found');
  }
  let sweeping = false;
  const sweep = setInterval(() => {
    sessions.expire();
    for (const s of sessions.all()) if (s.status === 'closing' && s.expiresAt <= Date.now()) finalize(s, 'expired');
    syncClosedSessions();
    summaries.retain(new Set(sessions.all().map(s => s.id)));
    if (!sweeping && options.resources) {
      sweeping = true;
      void options.resources.sweep().then(syncClosedSessions).catch(() => {}).finally(() => { sweeping = false; });
    }
  }, 5000);
  sweep.unref();
  return { server, sessions, summaries, async close() {
    shuttingDown = true; clearInterval(sweep);
    tickets.clear();
    for (const c of preparations.values()) c.abort('shutdown');
    for (const s of sessions.all()) { s.status = 'closing'; sessions.revoke(s); finalize(s, 'shutdown'); }
    const closed = new Promise<void>(resolve => server.close(() => resolve()));
    await options.resources?.sweep(Date.now(), true);
    server.closeAllConnections(); await closed;
  } };
}
