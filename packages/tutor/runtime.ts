import { Agent, type StreamFn } from '@earendil-works/pi-agent-core';
import { contentText, createFauxCore, fauxAssistantMessage, type Model } from '@earendil-works/pi-ai';
import { streamSimple as streamSimpleOpenAICompletions } from '@earendil-works/pi-ai/api/openai-completions';
import type { LearnerContext } from '../business/context.js';
import { actions, parseDecision, teachingPolicy, type Decision } from './policy.js';
import { teachingInstructions, type TeachingState } from './teaching-state.js';
import { isHttpsBaseUrl } from '../config/runtime.js';

export interface TutorInput {
  context: LearnerContext;
  users: string[];
  priorReplies: { text: string; status: string; presentation: 'unknown' }[];
  greeting?: boolean;
  teaching?: TeachingState;
  summaryReview?: { summaryId: string; oralReview: string; sourceQuotes: string[] };
}
export interface Tutor {
  decide(input: TutorInput, signal: AbortSignal): Promise<Decision>;
  speak(input: TutorInput, decision: Decision, signal: AbortSignal, onText: (text: string) => Promise<void>): Promise<void>;
}
export interface PiOptions { model: Model<'openai-completions'>; streamFn: StreamFn; decisionMs?: number; generationMs?: number }

export function fixturePiOptions(delayMs = 0): PiOptions {
  const model: Model<'openai-completions'> = { id: 'synthetic-offline', name: 'Offline synthetic probe', api: 'openai-completions',
    provider: 'ask-kai-fixture', baseUrl: 'https://invalid.example', input: ['text'], reasoning: false,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 2048 };
  const streamFn: StreamFn = (_model, context, options) => {
    const faux = createFauxCore({ tokensPerSecond: 500, tokenSize: { min: 3, max: 3 } });
    faux.setResponses([async () => {
      if (delayMs) await new Promise<void>(resolve => {
        const timer = setTimeout(finish, delayMs);
        function finish() { clearTimeout(timer); options?.signal?.removeEventListener('abort', finish); resolve(); }
        options?.signal?.addEventListener('abort', finish, { once: true });
        if (options?.signal?.aborted) finish();
      });
      const first = context.messages[0];
      const decision = first?.role === 'system' && String(first.content).includes('MODE:DECISION');
      const last = context.messages.at(-1);
      const data = JSON.parse(last && 'content' in last ? contentText(last.content) : '{}') as TutorInput;
      return fauxAssistantMessage(decision ? JSON.stringify({ action: 'RESPOND', reason: '离线合成决策，仅用于协议验证' })
        : data.greeting ? '你好，我是 Kai。今天想聊什么？'
          : `这是离线合成回复，${data.context.profile.name}。我们可以继续聊你刚才提到的事。`);
    }]);
    return faux.streamSimple(_model, context, options);
  };
  return { model, streamFn, decisionMs: 500, generationMs: 20000 };
}

export function livePiOptions(env: NodeJS.ProcessEnv, transport: typeof fetch = fetch): PiOptions {
  const id = env.PI_MODEL_ID;
  const baseUrl = env.PI_MODEL_BASE_URL;
  const apiKey = env.PI_MODEL_API_KEY;
  if (!id || !baseUrl || !apiKey) throw new Error('live_model_requires_confirmed_endpoint_id_and_key');
  if (!isHttpsBaseUrl(baseUrl)) throw new Error('live_model_requires_https_base_url_without_credentials_or_query');
  return { model: { ...fixturePiOptions().model, id, name: id, provider: 'ask-kai-approved', baseUrl },
    streamFn: (model, context, options) => streamSimpleOpenAICompletions(model as Model<'openai-completions'>, context,
      { ...options, fetch: transport, apiKey, maxRetries: 0, timeoutMs: 20000, maxTokens: 2048 }), decisionMs: 500, generationMs: 20000 };
}

export class PiTutor implements Tutor {
  constructor(private options: PiOptions) {}
  private async execute(mode: 'DECISION' | 'SPEECH', input: TutorInput, signal: AbortSignal, onText?: (text: string) => Promise<void>, decision?: Decision) {
    signal.throwIfAborted();
    const payload = JSON.stringify(mode === 'SPEECH' ? { ...input, acceptedDecision: { action: decision?.action, correction: decision?.correction } } : input);
    if (Buffer.byteLength(payload, 'utf8') > 24000) throw new Error('context_budget_exceeded');
    const timerSignal = AbortSignal.timeout(mode === 'DECISION' ? (this.options.decisionMs ?? 500) : (this.options.generationMs ?? 20000));
    const combined = AbortSignal.any([signal, timerSignal]);
    const agent = new Agent({ streamFn: this.options.streamFn, sessionId: undefined, maxRetryDelayMs: 1,
      initialState: { model: this.options.model, tools: [], systemPrompt: `${teachingPolicy}\n${input.teaching ? teachingInstructions(input.teaching) : ''}\n${input.summaryReview ? '本次是已有摘要的来源审查，核对 oralReview 与 sourceQuotes，不增加事实、知识点或掌握结论；返回 REVIEW 和简短核对说明，不生成口语。' : ''}\nMODE:${mode}\n${mode === 'DECISION'
        ? `只返回 JSON，例如 {"action":"RESPOND","reason":"简短依据"}。action 仅选一个：${actions.join('、')}。仅当 CORRECT 时可增加 correction={"kind":"wording","quote":"当前输入中的原文","replacement":"一个替代表达"}；只选一个文字表达重点，不能评定发音或掌握，不含额外字段。`
        : `只输出给学生听的口语文本。已校验的主要动作：${decision?.action}。若有 acceptedDecision.correction，只解释该单一文字重点，不增加其他纠错。不得输出 JSON、Markdown、内部计划。`}` },
      // No tools or autonomous follow-up loop in M0; authorized context is read once locally.
      finishTurn: () => ({ action: 'end' }) });
    const abort = () => agent.abort();
    combined.addEventListener('abort', abort, { once: true });
    let text = '';
    let speechStarted = false; let prefix = '';
    agent.subscribe(async event => {
      if (event.type !== 'message_update' || event.assistantMessageEvent.type !== 'text_delta') return;
      combined.throwIfAborted();
      const delta = event.assistantMessageEvent.delta;
      text += delta;
      if (text.length > (mode === 'DECISION' ? 4096 : 16000)) { agent.abort(); throw new Error('output_budget_exceeded'); }
      if (onText) {
        if (!speechStarted) {
          prefix += delta;
          if (!prefix.trimStart()) return;
          // Format gate only, not a semantic/content moderation guarantee.
          if (/^[{\[`<]/u.test(prefix.trimStart())) { agent.abort(); throw new Error('invalid_spoken_format'); }
          speechStarted = true; await onText(prefix); prefix = '';
        } else await onText(delta);
      }
    });
    try {
      await agent.prompt(payload);
      combined.throwIfAborted();
      const result = agent.state.messages.at(-1);
      if (result?.role !== 'assistant' || result.stopReason !== 'stop' || result.content.some(c => c.type === 'toolCall') || !text.trim()) throw new Error('pi_response_failed');
      return text;
    } finally {
      agent.abort();
      combined.removeEventListener('abort', abort);
    }
  }
  async decide(input: TutorInput, signal: AbortSignal): Promise<Decision> {
    try { return parseDecision(await this.execute('DECISION', input, signal)); }
    catch (error) {
      signal.throwIfAborted();
      if (error instanceof Error && error.name === 'TimeoutError') return { action: 'RESPOND', reason: '决策预算超时，回应当前意思', source: 'timeout-default' };
      throw error;
    }
  }
  async speak(input: TutorInput, decision: Decision, signal: AbortSignal, onText: (text: string) => Promise<void>) {
    await this.execute('SPEECH', input, signal, onText, decision);
  }
}
