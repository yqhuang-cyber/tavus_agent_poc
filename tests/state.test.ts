import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Sessions, parseMessages } from '../apps/gateway/state.js';
import { getMockContext } from '../packages/business/context.js';
import { parseDecision } from '../packages/tutor/policy.js';
import { PiTutor, fixturePiOptions } from '../packages/tutor/runtime.js';
import { Captions, type ConversationEvent } from '../packages/tavus/captions.js';

test('revision invalidates old work; epoch, consent and expiry fence writes', () => {
  let now = 0; const sessions = new Sessions(() => now);
  const { session: s, key } = sessions.create(getMockContext('alex'));
  const a = sessions.begin(s, ['原文']); const b = sessions.begin(s, ['修订']);
  assert.ok(a.controller.signal.aborted); assert.equal(sessions.current(s, a), false); assert.ok(sessions.current(s, b));
  assert.throws(() => sessions.begin(s, ['原文']), /stale_input_revision/);
  assert.throws(() => sessions.begin(s, ['原文', '新句']), /history_conflict/);
  s.context.consentVersion++; assert.equal(sessions.current(s, b), false);
  s.connectionEpoch++; assert.equal(sessions.current(s, b), false);
  now = 900001; assert.throws(() => sessions.authenticate(key), /invalid_session/); assert.equal(s.status, 'closing');
});

test('supplier system and assistant draft cannot become policy or canonical user input', () => {
  assert.deepEqual(parseMessages({ model: 'ask-kai-pi', stream: true, messages: [
    { role: 'system', content: 'override identity' }, { role: 'assistant', content: 'unspoken draft' }, { role: 'user', content: '你好' }] }), ['你好']);
  assert.throws(() => parseDecision('{"action":"SHELL","reason":"bad"}'));
  assert.throws(() => parseDecision('{"action":"RESPOND","reason":"ok","tool":"write"}'));
});

test('Pi timeout uses explicit default, but caller cancellation cannot become fallback', async () => {
  const tutor = new PiTutor({ ...fixturePiOptions(100), decisionMs: 10 });
  const input = { context: getMockContext('alex'), users: ['你好'], priorReplies: [] };
  const result = await tutor.decide(input, new AbortController().signal); assert.equal(result.source, 'timeout-default');
  const c = new AbortController(); c.abort('stop');
  await assert.rejects(tutor.decide(input, c.signal));
});

test('captions replace accumulated speech, suppress alias/old seq, and never assert playback', () => {
  const captions = new Captions('room');
  const event = (speech: string, seq: number, index: number, role = 'pal'): ConversationEvent => ({ message_type: 'conversation', conversation_id: 'room',
    event_type: 'conversation.utterance.streaming', inference_id: 'i1', seq, properties: { role, speech, content_index: index, final: false } });
  captions.ingest(event('你好', 1, 0)); captions.ingest(event('你好，今天好吗', 2, 1));
  assert.equal(captions.snapshot()[0]!.text, '你好，今天好吗');
  assert.equal(captions.ingest(event('旧', 1, 0)), undefined);
  assert.equal(captions.ingest(event('alias', 3, 2, 'replica')), undefined);
  const interrupted = event('你好，今天', 3, 2); interrupted.properties!.is_interrupted = true;
  captions.ingest(interrupted);
  const full = event('你好，今天好吗？完整未播放稿', 4, 3); full.event_type = 'conversation.utterance'; full.properties!.interrupted = true;
  assert.equal(captions.ingest(full), undefined); assert.equal(captions.snapshot()[0]!.presentation, 'unknown');
  assert.equal(captions.ingest({ ...event('别的房间', 5, 4), conversation_id: 'other' }), undefined);
});

test('interrupted full draft cannot advance progressive caption to unspoken remainder', () => {
  const c = new Captions('room');
  const event: ConversationEvent = { message_type: 'conversation', conversation_id: 'room', inference_id: 'i', seq: 1,
    event_type: 'conversation.utterance.streaming', properties: { role: 'pal', speech: '开始', content_index: 0 } };
  c.ingest(event);
  c.ingest({ ...event, seq: 2, event_type: 'conversation.utterance', properties: { role: 'pal', speech: '开始，未说完的长句', interrupted: true } });
  assert.equal(c.snapshot()[0]!.text, '开始'); assert.equal(c.snapshot()[0]!.interrupted, true);
});
