import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { LearnerContext } from '../../packages/business/context.js';
import type { Decision } from '../../packages/tutor/policy.js';
import { EvidenceJournal, type InputModality } from '../../packages/evidence/journal.js';
import { deriveTeachingState, type TeachingState } from '../../packages/tutor/teaching-state.js';
import { RunTiming } from '../../packages/observability/timing.js';

export class HttpError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export interface Run {
  responseId: string; turnId: string; stateVersion: number; consentVersion: number;
  contextVersion: number;
  connectionEpoch: number; controller: AbortController; status: 'running' | 'completed' | 'partial' | 'cancelled' | 'failed';
  decision?: Decision; forwardedCharacters: number; piCancelled: boolean; text: string;
  teaching?: TeachingState; proposedAction?: Decision['action']; policyGuards?: string[];
  timing: RunTiming;
}
export interface Session {
  id: string; context: LearnerContext; expiresAt: number; stateVersion: number; connectionEpoch: number;
  status: 'preparing' | 'joining' | 'active' | 'closing' | 'closed' | 'failed';
  gatewayHash: string; users: string[]; run?: Run; runs: Run[];
  seenInputs: Set<string>;
  evidence: EvidenceJournal; retired: boolean;
  teaching: TeachingState;
}

export class Sessions {
  private sessions = new Map<string, Session>();
  private credentials = new Map<string, string>();
  constructor(private now = Date.now, private monotonicNow: () => number = () => performance.now()) {}

  assertCapacity() {
    this.expire();
    if ([...this.sessions.values()].filter(s => !['closed', 'failed'].includes(s.status)).length >= 2) throw new HttpError(429, 'session_limit');
  }
  create(context: LearnerContext) {
    this.assertCapacity();
    const key = randomBytes(32).toString('base64url');
    const id = randomUUID();
    const session: Session = { id, context: structuredClone(context), expiresAt: this.now() + 900_000,
      stateVersion: 1, connectionEpoch: 1, status: 'preparing', gatewayHash: digest(key), users: [], runs: [], seenInputs: new Set(),
      evidence: new EvidenceJournal(id), retired: false, teaching: deriveTeachingState(context.preferences.chineseOnly, [], 1) };
    this.sessions.set(session.id, session);
    this.credentials.set(session.gatewayHash, session.id);
    return { session, key };
  }
  get(id: string) {
    const s = this.sessions.get(id);
    if (!s) throw new HttpError(404, 'unknown_session');
    return s;
  }
  authenticate(key: string | undefined) {
    this.expire();
    const id = key && this.credentials.get(digest(key));
    if (!id) throw new HttpError(401, 'invalid_session_credential');
    const s = this.get(id);
    if (!['preparing', 'joining', 'active'].includes(s.status)) throw new HttpError(409, 'session_not_open');
    return s;
  }
  begin(s: Session, users: string[], modality: InputModality = 'unknown', synthetic = false): Run {
    if (s.expiresAt <= this.now() || !['preparing', 'joining', 'active'].includes(s.status)) throw new HttpError(409, 'session_not_open');
    if (s.runs.length >= 200) throw new HttpError(429, 'session_turn_budget');
    if (users.length < s.users.length || s.users.slice(0, -1).some((v, i) => v !== users[i])) throw new HttpError(409, 'stale_or_rewritten_history');
    if (users.length > s.users.length && s.users.some((v, i) => v !== users[i])) throw new HttpError(409, 'history_conflict');
    if (users.length === s.users.length && users.at(-1) === s.users.at(-1)) throw new HttpError(409, 'duplicate_turn_probe_required');
    const inputHash = digest(JSON.stringify(users));
    if (s.seenInputs.has(inputHash)) throw new HttpError(409, 'stale_input_revision');
    this.cancel(s, 'superseded');
    s.seenInputs.add(inputHash);
    s.users = [...users];
    s.stateVersion++;
    const run: Run = { responseId: randomUUID(), turnId: `${s.id}:${users.length}`, stateVersion: s.stateVersion,
      consentVersion: s.context.consentVersion, connectionEpoch: s.connectionEpoch, controller: new AbortController(),
      contextVersion: s.context.version,
      status: 'running', forwardedCharacters: 0, piCancelled: false, text: '', timing: new RunTiming(this.monotonicNow) };
    s.run = run; s.runs.push(run);
    s.evidence.record({ sessionId: s.id, responseId: run.responseId, turnId: run.turnId, stateVersion: run.stateVersion,
      consentVersion: run.consentVersion, contextVersion: run.contextVersion, connectionEpoch: run.connectionEpoch }, users.at(-1)!, modality, synthetic);
    s.teaching = deriveTeachingState(s.context.preferences.chineseOnly, s.evidence.inspect().inputs, s.stateVersion);
    run.teaching = structuredClone(s.teaching);
    return run;
  }
  current(s: Session, run: Run) {
    return s.expiresAt > this.now() && s.run === run && run.stateVersion === s.stateVersion && run.connectionEpoch === s.connectionEpoch
      && run.consentVersion === s.context.consentVersion && run.contextVersion === s.context.version && run.status === 'running' && !run.controller.signal.aborted
      && ['preparing', 'joining', 'active'].includes(s.status);
  }
  cancel(s: Session, reason: string, expectedResponseId?: string) {
    if (expectedResponseId && s.run?.responseId !== expectedResponseId) throw new HttpError(409, 'stale_response');
    const run = s.run;
    if (!run || run.status !== 'running') return;
    s.stateVersion++;
    run.status = run.forwardedCharacters ? 'partial' : 'cancelled';
    run.timing.mark('cancel_requested');
    run.controller.abort(reason);
  }
  revoke(s: Session) { this.cancel(s, 'session_closed'); this.credentials.delete(s.gatewayHash); }
  all() { return [...this.sessions.values()]; }
  expire() {
    const expired: string[] = [];
    for (const s of this.sessions.values()) {
      if (s.expiresAt <= this.now() && !['closing', 'closed', 'failed'].includes(s.status)) {
        s.status = 'closing'; this.revoke(s); expired.push(s.id);
      }
      if (s.expiresAt + 60000 <= this.now() && ['closed', 'failed'].includes(s.status)) { s.retired = true; this.sessions.delete(s.id); }
    }
    return expired;
  }
  diagnostic(s: Session) {
    return { session_id: s.id, status: s.status, connection_epoch: s.connectionEpoch, state_version: s.stateVersion,
      source: s.context.source, coverage: s.context.coverage, expires_at: s.expiresAt,
      teaching: { version: s.teaching.version, language: s.teaching.language.mode, practice: s.teaching.practice.mode,
        goal_source_id: s.teaching.practice.request?.evidenceId, correction: s.teaching.correction.mode, complexity: s.teaching.complexity.mode,
        current_close_requested: s.teaching.current.closeRequested, recognition: s.teaching.recognition },
      runs: s.runs.map(r => ({ response_id: r.responseId, student_turn_id: r.turnId, state_version: r.stateVersion,
        consent_version: r.consentVersion, context_version: r.contextVersion, connection_epoch: r.connectionEpoch, status: r.status, action: r.decision?.action,
        decision_source: r.decision?.source, forwarded_characters: r.forwardedCharacters, pi_cancelled: r.piCancelled,
        proposed_action: r.proposedAction, policy_guards: r.policyGuards,
        timing: r.timing.view(),
        presentation: 'unknown' })) };
  }
}

export function parseMessages(value: unknown): string[] {
  if (!value || typeof value !== 'object') throw new HttpError(400, 'invalid_request');
  const body = value as Record<string, unknown>;
  if (body.model !== 'ask-kai-pi' || body.stream !== true || !Array.isArray(body.messages) || body.messages.length > 100) throw new HttpError(400, 'invalid_request');
  const users: string[] = [];
  for (const item of body.messages) {
    if (!item || typeof item !== 'object' || !['system', 'assistant', 'user'].includes(item.role) || typeof item.content !== 'string' || item.content.length > 8000) throw new HttpError(400, 'unsupported_message');
    // Never import supplier system prompts, assistant drafts or tools into canonical policy/history.
    if (item.role === 'user') {
      if (!item.content.trim()) throw new HttpError(400, 'empty_user_input');
      users.push(item.content);
    }
  }
  if (!users.length || body.messages.at(-1)?.role !== 'user') throw new HttpError(400, 'current_user_input_required');
  return users;
}
