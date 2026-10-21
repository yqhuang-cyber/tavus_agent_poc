import { nativeConfiguration } from '../packages/tavus/native-config.js';
import type { NativeApi } from '../packages/tavus/native-resources.js';
export const nativeToken = 'synthetic-native-operator-0123456789abcdef';
export const nativeConfig = nativeConfiguration({ operatorToken: nativeToken, publicUrl: 'https://native.example', faceId: 'face-1', voiceId: 'voice-1' });
export function nativeApi() {
  const calls: string[] = []; const tools: string[] = []; let rooms = 0; let ended = false;
  const api: NativeApi = {
    createTool: async body => { calls.push(`tool:${body.name}`); const tool_id = `tool-${tools.length}`; tools.push(tool_id); return { tool_id }; },
    createPal: async body => { calls.push('pal'); if ((body.layers as { llm: { base_url?: string } }).llm.base_url) throw new Error('must-use-native'); return { pal_id: 'native-pal' }; },
    getPal: async () => ({ ...nativeConfig.pal, pal_id: 'native-pal' }),
    attachTools: async () => { calls.push('attach'); return { data: tools.map(tool_id => ({ tool_id })) }; },
    getPalTools: async () => ({ data: tools.map(tool_id => ({ tool_id })) }),
    createConversation: async body => { calls.push(`room:${body.pal_id}`); rooms++; return { conversation_id: `room-${rooms}`,
      conversation_url: 'https://example.daily.co/room', meeting_token: 'SYNTHETIC-PRIVATE-JOIN-TOKEN' }; },
    getConversation: async id => { calls.push(`get:${id}`); return { conversation_id: id, status: ended ? 'ended' : 'active' }; },
    endConversation: async id => { calls.push(`end:${id}`); ended = true; },
  };
  return { api, calls, tools };
}
export function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
