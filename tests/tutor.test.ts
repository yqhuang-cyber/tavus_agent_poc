import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFauxCore, fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall } from '@earendil-works/pi-ai';
import { PiTutor, fixturePiOptions, livePiOptions } from '../packages/tutor/runtime.js';
import { getMockContext } from '../packages/business/context.js';
import { Sessions } from '../apps/gateway/state.js';

test('Pi thinking and internal decision never enter spoken text', async () => {
  const faux = createFauxCore({ tokensPerSecond: 10000 });
  faux.setResponses([fauxAssistantMessage([fauxThinking('INTERNAL_PRIVATE_PLAN'), fauxText('你好。')])]);
  const tutor = new PiTutor({ ...fixturePiOptions(), streamFn: faux.streamSimple });
  let output = '';
  await tutor.speak({ context: getMockContext('alex'), users: ['你好'], priorReplies: [] },
    { action: 'RESPOND', reason: 'PRIVATE_DECISION', source: 'pi' }, new AbortController().signal, async text => { output += text; });
  assert.equal(output, '你好。'); assert.equal(faux.state.callCount, 1);
});

test('invalid decision fails closed and excessive context never starts a model request', async () => {
  const faux = createFauxCore({ tokensPerSecond: 10000 }); faux.setResponses([fauxAssistantMessage('{"action":"READ_FILE","reason":"bad"}')]);
  const tutor = new PiTutor({ ...fixturePiOptions(), streamFn: faux.streamSimple });
  const input = { context: getMockContext('alex'), users: ['你好'], priorReplies: [] };
  await assert.rejects(tutor.decide(input, new AbortController().signal), /invalid_decision/);
  await assert.rejects(tutor.decide({ ...input, users: ['中'.repeat(9000)] }, new AbortController().signal), /context_budget/);
  assert.equal(faux.state.callCount, 1);
});

test('unconfirmed live model does not silently use a hosted Tavus model or fixture', () => {
  assert.throws(() => livePiOptions({ PI_MODEL_ID: 'tavus-gemma-4' }), /confirmed_endpoint/);
  assert.throws(() => livePiOptions({ PI_MODEL_ID: 'tavus-gemma-4', PI_MODEL_BASE_URL: 'http://invalid.example', PI_MODEL_API_KEY: 'test' }), /https/);
});

test('unexpected tools and structured speech fail without executing tools or forwarding JSON', async () => {
  for (const response of [fauxAssistantMessage(fauxToolCall('shell', { command: 'do-not-run' }), { stopReason: 'toolUse' }), fauxAssistantMessage('{"plan":"PRIVATE"}')]) {
    const faux = createFauxCore({ tokensPerSecond: 10000 }); faux.setResponses([response]);
    const tutor = new PiTutor({ ...fixturePiOptions(), streamFn: faux.streamSimple });
    let spoken = '';
    await assert.rejects(tutor.speak({ context: getMockContext('alex'), users: ['你好'], priorReplies: [] },
      { action: 'RESPOND', reason: '', source: 'pi' }, new AbortController().signal, async text => { spoken += text; }));
    assert.equal(spoken, ''); assert.equal(faux.state.callCount, 1);
  }
});

test('actual Pi OpenAI-compatible adapter calls decision then speech through a synthetic transport', async () => {
  let calls = 0;
  const transport: typeof fetch = async (url, init) => {
    assert.equal(String(url), 'https://approved-model.example/v1/chat/completions');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer synthetic-key');
    const request = JSON.parse(String(init?.body));
    assert.equal(request.model, 'tavus-gemma-4'); assert.equal(request.stream, true);
    const content = ++calls === 1 ? '{"action":"RESPOND","reason":"测试"}' : '你好，想聊什么？';
    const chunk = (delta: unknown, finish_reason: string | null = null) => `data: ${JSON.stringify({ id: 'synthetic-provider', object: 'chat.completion.chunk', created: 1,
      model: 'tavus-gemma-4', choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    return new Response(chunk({ role: 'assistant' }) + chunk({ content }) + chunk({}, 'stop') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  };
  const tutor = new PiTutor({ ...livePiOptions({ PI_MODEL_ID: 'tavus-gemma-4', PI_MODEL_BASE_URL: 'https://approved-model.example/v1', PI_MODEL_API_KEY: 'synthetic-key' }, transport), decisionMs: 2000 });
  const input = { context: getMockContext('alex'), users: ['你好'], priorReplies: [] }; const signal = new AbortController().signal;
  const decision = await tutor.decide(input, signal); assert.equal(decision.source, 'pi');
  let spoken = ''; await tutor.speak(input, decision, signal, async text => { spoken += text; });
  assert.equal(spoken, '你好，想聊什么？'); assert.equal(calls, 2);
});

test('both actual Pi steps receive trusted teaching constraints', async () => {
  const sessions = new Sessions(); const { session } = sessions.create(getMockContext('alex')); session.status = 'active';
  sessions.begin(session, ['只用中文，不想练习，不要纠正我。'], 'text', true);
  const faux = createFauxCore({ tokensPerSecond: 10000 });
  faux.setResponses([fauxAssistantMessage('{"action":"RESPOND","reason":"合成"}'), fauxAssistantMessage('可以，我们用中文聊。')]);
  const prompts: string[] = []; const payloads: string[] = [];
  const tutor = new PiTutor({ ...fixturePiOptions(), streamFn: (model, context, options) => {
    prompts.push(String(context.messages[0]!.content)); payloads.push(JSON.stringify(context.messages.at(-1)));
    return faux.streamSimple(model, context, options);
  } });
  const input = { context: session.context, users: session.users, priorReplies: [], teaching: session.teaching };
  const signal = new AbortController().signal; const decision = await tutor.decide(input, signal);
  await tutor.speak(input, decision, signal, async () => {});
  assert.equal(prompts.length, 2);
  for (const prompt of prompts) { assert.match(prompt, /当前只用中文/); assert.match(prompt, /学生已拒绝练习/); assert.match(prompt, /学生要求暂停纠错/); }
  assert.match(payloads[1]!, /acceptedDecision/);
});

test('selected correction remains a single data object and is never promoted into the Pi system prompt', async () => {
  const faux = createFauxCore({ tokensPerSecond: 10000 }); faux.setResponses([fauxAssistantMessage('可以用一个合适的量词。')]);
  const privateQuote = '三个书_SOURCE_ONLY'; let system = ''; let payload = '';
  const tutor = new PiTutor({ ...fixturePiOptions(), streamFn: (model, context, options) => {
    system = String(context.messages[0]!.content); payload = JSON.stringify(context.messages.at(-1));
    return faux.streamSimple(model, context, options);
  } });
  await tutor.speak({ context: getMockContext('alex'), users: [privateQuote], priorReplies: [] },
    { action: 'CORRECT', reason: 'PRIVATE_REASON', source: 'pi', correction: { kind: 'wording', quote: privateQuote, replacement: '三本书' } },
    new AbortController().signal, async () => {});
  assert.doesNotMatch(system, /SOURCE_ONLY|PRIVATE_REASON/); assert.match(payload, /SOURCE_ONLY/); assert.match(payload, /acceptedDecision/);
});
