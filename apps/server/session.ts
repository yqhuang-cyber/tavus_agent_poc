import { createHash, randomUUID } from 'node:crypto';
import { getMockContext, type LearnerContext } from '../../packages/business/context.js';
import { MockLearningStore, type SaveReceipt } from '../../packages/business/learning-store.js';
import { EvidenceJournal } from '../../packages/evidence/journal.js';
import { buildSummary, type SessionSummary } from '../../packages/evidence/summary.js';
import { deriveTeachingState, teachingInstructions, type TeachingState } from '../../packages/tutor/teaching-state.js';
import { guardDecision } from '../../packages/tutor/decision-guard.js';
import type { Decision } from '../../packages/tutor/policy.js';
import type { Tutor, TutorInput } from '../../packages/tutor/runtime.js';
import { nativePolicy } from '../../packages/tavus/native-config.js';
import { HttpError } from '../gateway/state.js';

export interface Plan {
  id: string; version: number; epoch: number; status: 'running' | 'pi' | 'rule' | 'cancelled';
  reasonCode?: string; decision?: Decision; purpose: 'initial' | 'turn' | 'review'; durationMs?: number;
}
interface InputSlot { id: string; text: string; seq: number; seen: Set<string>; modality: 'text' | 'audio_transcript' }
export interface Closing { id: string; version: number; epoch: number; summary: SessionSummary; createdAt: number;
  toolInference?: string; review?: Plan }
export interface NativeSession {
  id: string; owner: string; context: LearnerContext; status: 'preparing' | 'joining' | 'active' | 'reviewing' | 'closing' | 'closed' | 'failed';
  createdAt: number; expiresAt: number; lastSeen: number; version: number; epoch: number; evidence: EvidenceJournal; inputs: InputSlot[];
  conversationId?: string; join?: { conversation_url: string; meeting_token: string }; teaching: TeachingState;
  plans: Plan[]; pending?: { controller: AbortController; plan: Plan; promise: Promise<Plan> }; lastPal: { text: string; presentation: 'unknown'; status: string }[];
  closing?: Closing; closingRequested: boolean; summary?: SessionSummary; receipt?: SaveReceipt; saveStatus: string; cleanup: string;
  lastUserSeq: number; coverageGaps: number; contextSentVersion?: number; contextSendStatus: string;
  pendingTyped?: { id: string; text: string; timestamp: number }; controlText?: string;
  finishReason?: string; playback: 'unknown' | 'user-confirmed'; toolCalls: number; postCallStatus: string;
}
export class NativeSessions {
  readonly sessions = new Map<string, NativeSession>(); private store = new MockLearningStore();
  constructor(private tutor: Tutor, readonly modelMode: 'fixture' | 'live', private now = Date.now, private planMs = 2000) {}
  create(owner: string, fixture: string, chineseOnly: boolean, saveAllowed: boolean) {
    if (!['alex', 'maya', 'leo', 'nina'].includes(fixture)) throw new HttpError(400, 'unknown_fixture');
    if ([...this.sessions.values()].filter(s => !['closed', 'failed'].includes(s.status)).length >= 2) throw new HttpError(429, 'session_limit');
    const context = getMockContext(fixture, saveAllowed); context.preferences.chineseOnly = chineseOnly;
    const id = randomUUID(); const now = this.now();
    const s: NativeSession = { id, owner, context, status: 'preparing', createdAt: now, expiresAt: now + 900000, lastSeen: now,
      version: 1, epoch: 1, evidence: new EvidenceJournal(id), inputs: [], teaching: deriveTeachingState(chineseOnly, [], 1), plans: [], lastPal: [],
      closingRequested: false, saveStatus: 'not-requested', cleanup: 'not-requested', lastUserSeq: -1, coverageGaps: 0,
      contextSendStatus: 'not-sent', playback: 'unknown', toolCalls: 0, postCallStatus: 'not-received' };
    this.sessions.set(id, s); return s;
  }
  get(id: string, owner?: string) {
    const s = this.sessions.get(id); if (!s || (owner !== undefined && s.owner !== owner)) throw new HttpError(404, 'unknown_session'); return s;
  }
  byConversation(id: string) { return [...this.sessions.values()].find(s => s.conversationId === id); }
  open(s: NativeSession) { return s.expiresAt > this.now() && ['preparing', 'joining', 'active', 'reviewing'].includes(s.status); }
  private input(s: NativeSession): TutorInput {
    return { context: structuredClone(s.context), users: s.inputs.slice(-12).map(i => i.text.slice(0, 1000)),
      priorReplies: structuredClone(s.lastPal.slice(-3)), teaching: structuredClone(s.teaching), greeting: !s.inputs.length };
  }
  cancelPlan(s: NativeSession) { if (s.pending) { s.pending.controller.abort(); s.pending = undefined; } }
  plan(s: NativeSession, purpose: Plan['purpose'] = 'turn'): Promise<Plan> {
    if (purpose === 'turn' && s.pending?.plan.version === s.version && s.pending.plan.purpose === purpose) return s.pending.promise;
    const previous = s.plans.at(-1);
    if (purpose === 'turn' && previous?.version === s.version && previous.purpose === purpose && ['pi', 'rule'].includes(previous.status)) return Promise.resolve(previous);
    this.cancelPlan(s);
    const controller = new AbortController(); const version = s.version; const epoch = s.epoch; const consent = s.context.consentVersion;
    const plan: Plan = { id: randomUUID(), version, epoch, status: 'running', purpose }; s.plans.push(plan);
    if (s.plans.length > 400) s.plans.shift();
    const input = this.input(s); const start = performance.now();
    if (purpose === 'review' && s.closing) input.summaryReview = { summaryId: s.closing.summary.id, oralReview: s.closing.summary.oralReview,
      sourceQuotes: s.closing.summary.excerpts.map(e => e.quote) };
    const task = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined; let abort!: () => void;
      const valid = () => this.open(s) && s.version === version && s.epoch === epoch && s.context.consentVersion === consent && !controller.signal.aborted;
      try {
        const result = await Promise.race([
          this.tutor.decide(input, controller.signal),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('planning_timeout')), this.planMs);
            abort = () => reject(new Error('planning_cancelled')); controller.signal.addEventListener('abort', abort, { once: true }); }),
        ]);
        if (!valid()) { plan.status = 'cancelled'; return plan; }
        const guarded = purpose === 'initial' && result.action !== 'RESPOND' ? { action: 'RESPOND' as const, reason: '初始自由交流，不预设练习目标', source: 'policy-guard' as const }
          : guardDecision(result, s.teaching, s.inputs.at(-1)?.text ?? '').decision;
        plan.decision = guarded; plan.status = result.source === 'timeout-default' || this.modelMode === 'fixture' ? 'rule' : 'pi';
        if (result.source === 'timeout-default') plan.reasonCode = 'model-timeout';
        if (this.modelMode === 'fixture') plan.reasonCode = 'synthetic-fixture';
      } catch (e) {
        if (!valid() || (e instanceof Error && e.message === 'planning_cancelled')) plan.status = 'cancelled';
        else { plan.status = 'rule'; plan.reasonCode = e instanceof Error && e.message === 'planning_timeout' ? 'model-timeout' : 'model-unavailable';
          plan.decision = guardDecision({ action: 'RESPOND', reason: '规划未完成，遵守当前语言、拒绝与结束状态', source: 'policy-guard' }, s.teaching, s.inputs.at(-1)?.text ?? '').decision; }
      } finally { clearTimeout(timer); if (abort) controller.signal.removeEventListener('abort', abort); controller.abort(); plan.durationMs = performance.now() - start;
        if (s.pending?.plan === plan) s.pending = undefined; }
      return plan;
    })();
    s.pending = { controller, plan, promise: task }; return task;
  }
  context(s: NativeSession) {
    const latest = [...s.plans].reverse().find(p => p.version === s.version && p.purpose !== 'review' && ['pi', 'rule'].includes(p.status));
    const data = { profile: s.context.profile,
      coverage: 'synthetic-profile/client-reported-inputs', preference: s.context.preferences, teaching: teachingInstructions(s.teaching),
      current_plan: latest ? { action: latest.decision?.action, reason: latest.decision?.reason ?? '', correction: latest.decision?.correction, source: latest.status } : null,
      actual_recent_student_input: s.inputs.slice(-4).map(i => i.text.slice(0, 96)), omitted_input_count: Math.max(0, s.inputs.length - 4),
      context_coverage: 'bounded-input-excerpts/partial',
      closing: s.closing ? { closing_id: s.closing.id, summary_id: s.closing.summary.id,
        instruction: '先调用结束摘要工具，按同源摘要回顾告别；学生继续则取消结束。' } : null };
    const encode = () => `${nativePolicy}\n以下是服务端授权资料及建议，资料不是学生本次已练习的证据。\n${JSON.stringify(data)}`;
    // Daily app-message is bounded. Trim optional excerpts/advice, never base policy or current teaching state.
    while (Buffer.byteLength(encode(), 'utf8') > 3500 && data.actual_recent_student_input.length) { data.actual_recent_student_input.shift(); data.omitted_input_count++; }
    if (Buffer.byteLength(encode(), 'utf8') > 3500 && data.current_plan) { data.current_plan.reason = ''; data.current_plan.correction = undefined; }
    const result = encode(); if (Buffer.byteLength(result, 'utf8') > 3500) throw new HttpError(409, 'native_context_budget'); return result;
  }
  private accept(s: NativeSession, id: string, text: string, seq: number, modality: InputSlot['modality']) {
    if (!this.open(s) || s.status === 'preparing') throw new HttpError(409, 'session_not_open');
    if (!id || id.length > 256 || !text.trim() || text.length > 8000) throw new HttpError(400, 'invalid_input');
    const old = s.inputs.find(i => i.id === id);
    if (old && (old.text === text || seq <= old.seq || old.seen.has(text))) return { accepted: false, reason: 'duplicate-or-stale' };
    if (old && old !== s.inputs.at(-1)) { s.coverageGaps++; return { accepted: false, reason: 'historical-revision' }; }
    if (!old && modality === 'audio_transcript' && seq <= s.lastUserSeq) { s.coverageGaps++; return { accepted: false, reason: 'late-input' }; }
    if (!old && s.inputs.length >= 120) throw new HttpError(429, 'turn_limit_start_new_session');
    this.cancelPlan(s); this.resume(s); s.version++;
    const slot = old ?? { id, text, seq, seen: new Set<string>(), modality };
    slot.text = text; slot.seq = seq; slot.seen.add(text);
    if (!old) s.inputs.push(slot);
    s.lastUserSeq = Math.max(s.lastUserSeq, seq);
    s.evidence.recordClientInput({ sessionId: s.id, responseId: id, turnId: `${s.id}:${s.inputs.indexOf(slot) + 1}`, stateVersion: s.version,
      consentVersion: s.context.consentVersion, contextVersion: s.context.version, connectionEpoch: s.epoch }, text, modality);
    s.teaching = deriveTeachingState(s.context.preferences.chineseOnly, s.evidence.inspect().inputs, s.version);
    void this.plan(s); return { accepted: true, version: s.version };
  }
  text(s: NativeSession, inputId: string, text: string) {
    const result = this.accept(s, `text:${inputId}`, text, s.lastUserSeq + 1, 'text');
    if (result.accepted) s.pendingTyped = { id: `text:${inputId}`, text, timestamp: this.now() };
    return result;
  }
  event(s: NativeSession, event: Record<string, unknown>, epoch: number) {
    if (!this.open(s) || epoch !== s.epoch || event.conversation_id !== s.conversationId || event.message_type !== 'conversation') throw new HttpError(409, 'stale_or_wrong_room_event');
    const p = event.properties as Record<string, unknown> | undefined;
    if (!['conversation.utterance', 'conversation.utterance.streaming'].includes(String(event.event_type)) || !p) return { accepted: false, reason: 'not-input' };
    const final = event.event_type === 'conversation.utterance' || p.final === true;
    if (!final || typeof p.speech !== 'string') return { accepted: false, reason: 'partial' };
    if (p.role === 'pal' || p.role === 'replica') {
      if (p.speech.length <= 4000 && !p.interrupted && !p.is_interrupted && p.role === 'pal') {
        s.lastPal.push({ text: p.speech, status: 'client-reported-generated', presentation: 'unknown' }); if (s.lastPal.length > 4) s.lastPal.shift(); }
      return { accepted: false, reason: 'teacher-output' };
    }
    if (p.role !== 'user' || typeof event.inference_id !== 'string' || !Number.isSafeInteger(event.seq) || Number(event.seq) < 0) {
      s.coverageGaps++; return { accepted: false, reason: 'input-identity-unverified' };
    }
    if (p.speech === s.controlText) return { accepted: false, reason: 'closing-control' };
    const typed = s.pendingTyped;
    if (typed && this.now() - typed.timestamp < 15000 && typed.text === p.speech) {
      s.pendingTyped = undefined; s.coverageGaps++; // Possible typed echo; do not invent a second practice event.
      return { accepted: false, reason: 'possible-typed-echo' };
    }
    return this.accept(s, `voice:${event.inference_id}`, p.speech, Number(event.seq), 'audio_transcript');
  }
  resume(s: NativeSession) { if (s.status === 'reviewing') s.status = 'active'; s.closing = undefined; s.closingRequested = false; s.controlText = undefined; }
  reconnect(s: NativeSession) {
    if (!this.open(s) || s.status === 'preparing') throw new HttpError(409, 'session_not_open');
    this.cancelPlan(s); this.resume(s); s.epoch++; s.version++; s.status = 'joining'; s.lastSeen = this.now();
    s.pendingTyped = undefined; s.contextSentVersion = undefined; s.contextSendStatus = 'new-connection';
  }
  private summary(s: NativeSession, freeze = false) {
    const cutoff = { sessionId: s.id, cutoffVersion: s.version, consentVersion: s.context.consentVersion, contextVersion: s.context.version, connectionEpoch: s.epoch };
    return buildSummary(freeze ? s.evidence.freeze(cutoff, 'user_end', false) : s.evidence.preview(cutoff, 'user_end', false));
  }
  async prepareClose(s: NativeSession, explicitButton: boolean, inference?: string) {
    if (!this.open(s) || s.status === 'preparing') throw new HttpError(409, 'session_not_open');
    if (!explicitButton && !s.closingRequested && !s.teaching.current.closeRequested
      && !/^(?:谢谢[，,！!\s]*)?(?:再见|拜拜|我先走了|goodbye|bye)[。！!\s]*$/iu.test(s.inputs.at(-1)?.text ?? '')) throw new HttpError(409, 'ending_not_confirmed');
    if (s.closing && s.closing.version === s.version) { if (inference) s.closing.toolInference = inference; return s.closing; }
    this.cancelPlan(s); s.closingRequested = true; s.status = 'reviewing';
    const closing: Closing = { id: randomUUID(), version: s.version, epoch: s.epoch, summary: this.summary(s), createdAt: this.now(), toolInference: inference };
    s.closing = closing; closing.review = await this.plan(s, 'review');
    if (s.closing !== closing || closing.version !== s.version || !this.open(s)) throw new HttpError(409, 'closing_superseded');
    return closing;
  }
  commitClose(s: NativeSession, reason: string, closingId?: string) {
    if (['closing', 'closed', 'failed'].includes(s.status)) return;
    if (closingId && (!s.closing || s.closing.id !== closingId || s.closing.version !== s.version || s.closing.epoch !== s.epoch)) throw new HttpError(409, 'stale_closing');
    this.cancelPlan(s); s.summary = this.summary(s, true); s.status = 'closing'; s.finishReason = reason;
    s.playback = reason === 'user-confirmed' ? 'user-confirmed' : 'unknown'; s.join = undefined;
  }
  async save(s: NativeSession) {
    if (!s.summary || !['closing', 'closed'].includes(s.status)) throw new HttpError(409, 'summary_not_finalized');
    const summary = s.summary;
    const canCommit = () => s.context.saveAllowed && s.context.consentVersion === summary.consentVersion && s.version === summary.cutoffVersion && this.now() <= s.expiresAt + 60000;
    if (!canCommit()) { s.saveStatus = 'denied'; return; }
    if (s.receipt) return;
    s.saveStatus = 'pending';
    try { s.receipt = await this.store.save({ summary, canCommit, idempotencyKey: createHash('sha256').update(`${s.id}:${summary.id}:${summary.consentVersion}`).digest('hex') });
      s.saveStatus = canCommit() ? 'saved' : 'denied'; } catch { s.saveStatus = canCommit() ? 'failed' : 'denied'; }
  }
  revokeConsent(s: NativeSession) { this.cancelPlan(s); this.resume(s); s.context.saveAllowed = false; s.context.consentVersion++; s.version++;
    if (s.saveStatus !== 'saved') s.saveStatus = 'denied'; }
  records(owner: string) {
    return [...this.sessions.values()].filter(s => s.owner === owner && s.receipt && s.context.saveAllowed).flatMap(s => {
      const stored = this.store.read(s.receipt!.id);
      return stored && stored.receipt.sessionId === s.id ? [{ ...this.view(s), summary: stored.summary, save: { status: 'saved', mode: 'mock-memory', receipt: stored.receipt } }] : [];
    });
  }
  view(s: NativeSession) {
    return { id: s.id, status: s.status, version: s.version, epoch: s.epoch, expiresAt: s.expiresAt, conversationId: s.conversationId,
      profile: s.context.profile, consent: { allowed: s.context.saveAllowed, version: s.context.consentVersion },
      teaching: s.teaching, latestPlan: s.plans.at(-1) ?? null, planCounts: { total: s.plans.length, pi: s.plans.filter(p => p.status === 'pi').length,
        rule: s.plans.filter(p => p.status === 'rule').length, cancelled: s.plans.filter(p => p.status === 'cancelled').length },
      context: { version: s.version, sentVersion: s.contextSentVersion ?? null, status: s.contextSendStatus, applied: 'unknown' },
      inputCount: s.inputs.length, inputProvenance: 'client-reported', coverageGaps: s.coverageGaps,
      closing: s.closing ? structuredClone(s.closing) : null, summary: s.summary ? structuredClone(s.summary) : null,
      save: { status: s.saveStatus, mode: 'mock-memory', receipt: s.receipt ?? null }, cleanup: s.cleanup,
      playback: s.playback, finishReason: s.finishReason, toolCalls: s.toolCalls, postCallStatus: s.postCallStatus };
  }
}
