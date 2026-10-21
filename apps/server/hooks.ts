import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { HttpError } from '../gateway/state.js';
import type { NativeConfiguration } from '../../packages/tavus/native-config.js';
import type { NativeSessions, NativeSession } from './session.js';

interface Envelope { name: string; arguments: string; tool_call_id: string; conversation_id: string; inference_id?: string; turn_idx?: number }
interface Job { id: string; sessionId: string; hash: string; status: 'pending' | 'reviewed' | 'authorization-expired' | 'denied'; matchedCandidates: number }
export class NativeHooks {
  private calls = new Map<string, { hash: string; version: number; epoch: number; promise: Promise<unknown> }>();
  private jobs: Job[] = []; private writing = Promise.resolve();
  constructor(private sessions: NativeSessions, private config: NativeConfiguration, private path: string) {}
  async load() {
    try {
      const raw: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      if (!Array.isArray(raw) || raw.length > 1000 || raw.some(j => !j || typeof j.id !== 'string' || typeof j.sessionId !== 'string'
        || !/^[a-f0-9]{64}$/u.test(j.hash) || !['pending', 'reviewed', 'authorization-expired', 'denied'].includes(j.status)
        || !Number.isSafeInteger(j.matchedCandidates) || j.matchedCandidates < 0
        || Object.keys(j).some(k => !['id', 'sessionId', 'hash', 'status', 'matchedCandidates'].includes(k)))) throw new Error();
      this.jobs = raw;
      // Mock learner authority is in memory and cannot survive process restart.
      for (const job of this.jobs) if (job.status === 'pending') job.status = 'authorization-expired';
      await this.save();
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('native_job_ledger_invalid'); }
  }
  private save() {
    const bytes = JSON.stringify(this.jobs, null, 2);
    const next = this.writing.then(async () => { await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      await writeFile(`${this.path}.tmp`, bytes, { mode: 0o600 }); await rename(`${this.path}.tmp`, this.path); });
    this.writing = next.catch(() => {}); return next;
  }
  private envelope(raw: Buffer, signature: string | undefined, post: boolean) {
    if (!signature || !/^[a-f0-9]{64}$/iu.test(signature)) throw new HttpError(401, 'tool_signature_required');
    const expected = createHmac('sha256', post ? this.config.postSecret : this.config.toolSecret).update(raw).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) throw new HttpError(401, 'invalid_tool_signature');
    let e: Envelope;
    try { e = JSON.parse(raw.toString('utf8')) as Envelope; } catch { throw new HttpError(400, 'invalid_tool_envelope'); }
    if (!e || typeof e !== 'object' || ![e.name, e.tool_call_id, e.conversation_id].every(v => typeof v === 'string' && v.length > 0 && v.length <= 256)
      || typeof e.arguments !== 'string' || e.arguments.length > 12000 || (e.inference_id !== undefined && (typeof e.inference_id !== 'string' || e.inference_id.length > 256))) throw new HttpError(400, 'invalid_tool_envelope');
    return e;
  }
  private args(e: Envelope, keys: string[]) {
    let args: Record<string, unknown>;
    try { args = JSON.parse(e.arguments); } catch { throw new HttpError(400, 'invalid_tool_arguments'); }
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(k => !keys.includes(k))) throw new HttpError(400, 'invalid_tool_arguments');
    for (const key of keys) if (!Object.hasOwn(args, key)) throw new HttpError(400, 'invalid_tool_arguments');
    return args;
  }
  async handle(raw: Buffer, signature: string | undefined, post: boolean) {
    const e = this.envelope(raw, signature, post); const s = this.sessions.byConversation(e.conversation_id);
    if (!s || Date.now() > s.expiresAt + (post ? 60000 : 0) || (!post && !this.sessions.open(s))) throw new HttpError(409, 'tool_session_unavailable');
    const allowed = post ? [this.config.names.post] : [this.config.names.teaching, this.config.names.closing];
    if (!allowed.includes(e.name)) throw new HttpError(400, 'unknown_tool');
    const key = `${e.conversation_id}:${e.tool_call_id}`; const hash = createHash('sha256').update(raw).digest('hex');
    const previous = this.calls.get(key);
    if (previous) {
      if (previous.hash !== hash) throw new HttpError(409, 'tool_idempotency_conflict');
      if (!post && (previous.version !== s.version || previous.epoch !== s.epoch)) return { status: 'stale', directive: '回应当前学生，不使用旧计划或旧摘要。' };
      return previous.promise;
    }
    if (this.calls.size >= 2000) throw new HttpError(429, 'tool_call_budget');
    const version = s.version; const epoch = s.epoch; s.toolCalls++;
    const promise = this.execute(s, e, key, hash, post).then(result => {
      if (!post && (!this.sessions.open(s) || s.version !== version || s.epoch !== epoch)) return { status: 'stale', directive: '学生已继续或会话已结束，不使用旧结果。' };
      return result;
    });
    this.calls.set(key, { hash, version, epoch, promise }); return promise;
  }
  private async execute(s: NativeSession, e: Envelope, key: string, hash: string, post: boolean): Promise<unknown> {
    if (post) {
      const args = this.args(e, ['summary_candidate', 'attempt_candidates']);
      if (typeof args.summary_candidate !== 'string' || args.summary_candidate.length > 4000 || !Array.isArray(args.attempt_candidates)
        || args.attempt_candidates.length > 10 || args.attempt_candidates.some(a => typeof a !== 'string' || !a.trim() || a.length > 240)) throw new HttpError(400, 'invalid_post_call_candidates');
      const previous = this.jobs.find(j => j.id === key);
      if (previous) { if (previous.hash !== hash) throw new HttpError(409, 'tool_idempotency_conflict'); return { status: 'received', jobStatus: previous.status }; }
      if (this.jobs.length >= 1000) throw new HttpError(429, 'post_call_job_budget');
      const job: Job = { id: key, sessionId: s.id, hash, status: s.context.saveAllowed ? 'pending' : 'denied', matchedCandidates: 0 };
      this.jobs.push(job); await this.save(); // Acknowledge only after durable, minimal receipt; no transcript/candidate text persisted.
      if (job.status === 'pending') {
        const inputs = s.evidence.inspect().inputs;
        job.matchedCandidates = args.attempt_candidates.filter(a => inputs.some(i => i.text.includes(String(a)))).length;
        job.status = 'reviewed'; s.postCallStatus = 'source-matched/no-new-learning-facts'; await this.save();
      } else s.postCallStatus = 'received-without-save-consent';
      return { status: 'received', jobStatus: job.status, acceptedLearningFacts: 0 };
    }
    if (e.name === this.config.names.teaching) {
      const args = this.args(e, ['reason', 'student_request']);
      if (!['practice_request', 'adjust_scaffolding', 'change_goal'].includes(String(args.reason)) || typeof args.student_request !== 'string' || args.student_request.length > 1000) throw new HttpError(400, 'invalid_tool_arguments');
      if (!s.inputs.length) { s.coverageGaps++; return { status: 'input-not-observed', scope: 'provisional', directive: '遵守学生当前请求，不增加未经确认的练习或学习事实。' }; }
      const plan = await this.sessions.plan(s);
      return { status: plan.status, plan_id: plan.id, state_version: plan.version, action: plan.decision?.action,
        reason: plan.decision?.reason, scope: 'latest-observed-input-advisory', evidence_status: 'planning-only/client-reported',
        constraints: ['接受拒绝和换题', '不评定发音或掌握', '新输入优先于旧计划'], teaching: s.teaching };
    }
    const args = this.args(e, ['ending_request']);
    if (typeof args.ending_request !== 'string' || args.ending_request.length > 1000) throw new HttpError(400, 'invalid_tool_arguments');
    const closing = await this.sessions.prepareClose(s, false, e.inference_id);
    return { status: 'ok', closing_id: closing.id, summary_hash: closing.summary.id, summary_revision: closing.version,
      conversation_recap: closing.summary.oralReview, knowledge_points: [], source_refs: closing.summary.excerpts,
      constraints: ['仅回顾上述来源，不增加学习成果', '回顾后告别，不继续发问', '工具无挂断权限；学生继续时旧摘要失效'] };
  }
}
