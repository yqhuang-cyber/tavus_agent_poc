export type TavusFailureCode = 'http' | 'timeout' | 'dns' | 'tls' | 'connection' | 'invalid_response' | 'transport';
export class TavusError extends Error {
  constructor(public status: number | undefined, public outcomeUnknown: boolean,
    public failureCode: TavusFailureCode = status === undefined ? 'transport' : 'http') {
    super(outcomeUnknown ? 'tavus_outcome_unknown' : 'tavus_request_failed');
  }
}
function transportFailure(error: unknown): TavusFailureCode {
  // Inspect bounded cause chains; never copy messages, URLs or arbitrary codes into reports.
  for (let depth = 0; depth < 5 && error && typeof error === 'object'; depth++) {
    const e = error as { name?: unknown; code?: unknown; cause?: unknown };
    if (e.name === 'TimeoutError' || ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(String(e.code))) return 'timeout';
    if (['ENOTFOUND', 'EAI_AGAIN'].includes(String(e.code))) return 'dns';
    if (['CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(String(e.code))) return 'tls';
    if (['ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_SOCKET'].includes(String(e.code))) return 'connection';
    error = e.cause;
  }
  return 'transport';
}
export interface TavusApi {
  createPal(body: Record<string, unknown>): Promise<{ pal_id: string }>;
  getPal(id: string): Promise<Record<string, unknown>>;
  createConversation(body: Record<string, unknown>): Promise<{ conversation_id: string; conversation_url: string; meeting_token: string }>;
  getConversation(id: string): Promise<Record<string, unknown>>;
  endConversation(id: string): Promise<void>;
  deletePal(id: string): Promise<void>;
}

export class TavusClient implements TavusApi {
  constructor(private key: string, private transport: typeof fetch = fetch) {}
  private async request(method: string, path: string, expected: number, body?: unknown): Promise<Record<string, unknown>> {
    const create = method === 'POST' && !path.endsWith('/end');
    let httpStatus: number | undefined; let parsing = false;
    try {
      const response = await this.transport(`https://tavusapi.com${path}`, { method, signal: AbortSignal.timeout(10000),
        redirect: 'error', headers: { 'x-api-key': this.key, ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      httpStatus = response.status;
      if (response.status !== expected) {
        await response.body?.cancel();
        throw new TavusError(response.status, create && (response.status >= 500 || response.status === 408));
      }
      if (expected === 204 || path.endsWith('/end')) { await response.body?.cancel(); return {}; }
      const text = await response.text();
      parsing = true;
      if (text.length > 1_000_000) throw new Error('oversized_response');
      const data: unknown = JSON.parse(text);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid_resource');
      return data as Record<string, unknown>;
    } catch (error) {
      if (error instanceof TavusError) throw error;
      // Never leak response bodies, credentials, signed URLs, or transport errors.
      throw new TavusError(httpStatus, create, parsing ? 'invalid_response' : transportFailure(error));
    }
  }
  async createPal(body: Record<string, unknown>) {
    const data = await this.request('POST', '/v2/pals', 200, body);
    if (typeof data.pal_id !== 'string' || !data.pal_id) throw new TavusError(200, true, 'invalid_response');
    return { pal_id: data.pal_id };
  }
  getPal(id: string) { return this.request('GET', `/v2/pals/${encodeURIComponent(id)}`, 200); }
  getFace(id: string) { return this.request('GET', `/v2/faces/${encodeURIComponent(id)}`, 200); }
  getVoice(id: string) { return this.request('GET', `/v2/voices/${encodeURIComponent(id)}`, 200); }
  async createTool(body: Record<string, unknown>) {
    const data = await this.request('POST', '/v2/tools', 200, body);
    if (typeof data.tool_id !== 'string' || !data.tool_id) throw new TavusError(200, true, 'invalid_response');
    return { tool_id: data.tool_id };
  }
  attachTools(palId: string, toolIds: string[]) { return this.request('POST', `/v2/pals/${encodeURIComponent(palId)}/tools`, 200, { tool_ids: toolIds }); }
  getPalTools(palId: string) { return this.request('GET', `/v2/pals/${encodeURIComponent(palId)}/tools`, 200); }
  async createConversation(body: Record<string, unknown>) {
    const data = await this.request('POST', '/v2/conversations', 200, body);
    if (typeof data.conversation_id !== 'string' || !data.conversation_id) throw new TavusError(200, true, 'invalid_response');
    // Preserve the ID even if join credentials are absent, so cleanup can run.
    return { conversation_id: data.conversation_id, conversation_url: typeof data.conversation_url === 'string' ? data.conversation_url : '', meeting_token: typeof data.meeting_token === 'string' ? data.meeting_token : '' };
  }
  getConversation(id: string) { return this.request('GET', `/v2/conversations/${encodeURIComponent(id)}`, 200); }
  async endConversation(id: string) { await this.request('POST', `/v2/conversations/${encodeURIComponent(id)}/end`, 200); }
  async deletePal(id: string) { await this.request('DELETE', `/v2/pals/${encodeURIComponent(id)}`, 204); }
}

export function palConfig(id: string, face: string, voice: string | undefined, publicUrl: string, credential: string) {
  return { pal_name: `Ask Kai session ${id}`, pipeline_mode: 'full', default_face_id: face,
    system_prompt: '你是 Kai 中文老师。教学由 Pi Gateway 负责，中文优先，不把猜测当作学习事实。',
    greeting: '', dynamic_greeting: false, languages: ['zh', 'en'], layers: {
      llm: { model: 'ask-kai-pi', base_url: `${publicUrl}/v1`, api_key: credential,
        headers: { 'X-AskKai-Session-Key': credential }, speculative_inference: false },
      stt: { stt_engine: 'tavus-auto' },
      conversational_flow: { turn_detection_model: 'sparrow-2', turn_taking_patience: 'high', pal_interruptibility: 'high', idle_engagement: 'off' },
      ...(voice ? { tts: { voice_id: voice } } : {}), perception: { perception_model: 'off' },
    } };
}
export function conversationConfig(id: string, pal: string, face: string, publicUrl: string, greeting: string) {
  return { pal_id: pal, face_id: face, conversation_name: `Ask Kai ${id}`, require_auth: true,
    max_participants: 2, audio_only: false, callback_url: `${publicUrl}/hooks/tavus/conversation`,
    conversational_context: '内部合成资料测试；自由聊天，初始教学目标为空。', custom_greeting: greeting,
    dynamic_greeting: false, participant_tags: [], properties: { languages: ['zh', 'en'], max_call_duration: 900,
      participant_left_timeout: 10, participant_absent_timeout: 60, enable_closed_captions: true,
      enable_recording: false, auto_start_recording: false } };
}
