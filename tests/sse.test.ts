import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readSse } from '../packages/tavus/sse.js';

test('SSE survives every-byte UTF-8/network split, comments, multiline data and CRLF', async () => {
  const bytes = new TextEncoder().encode(': ping\r\n\r\ndata: {"text":"你好"}\r\n\r\ndata: line1\ndata: line2\n\ndata: [DONE]\n\n');
  const stream = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  const frames: string[] = []; for await (const frame of readSse(stream)) frames.push(frame);
  assert.deepEqual(frames, ['{"text":"你好"}', 'line1\nline2', '[DONE]']);
});
test('truncated SSE frame does not silently appear completed', async () => {
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('data: broken')); c.close(); } });
  await assert.rejects(async () => { for await (const _frame of readSse(stream)) { /* consume */ } }, /incomplete/);
});
