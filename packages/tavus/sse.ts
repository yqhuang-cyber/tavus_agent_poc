// SSE framing is independent of HTTP read boundaries and UTF-8 byte boundaries.
export async function* readSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader(); const decoder = new TextDecoder(); let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length);
        const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
        if (data) yield data;
      }
      if (buffer.length > 1_000_000) throw new Error('oversized_sse_frame');
      if (done) {
        if (buffer.trim()) throw new Error('incomplete_sse_frame');
        break;
      }
    }
  } finally { reader.releaseLock(); }
}
