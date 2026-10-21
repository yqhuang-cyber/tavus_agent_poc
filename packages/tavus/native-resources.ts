import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { TavusError, type TavusClient } from './client.js';
import type { NativeConfiguration } from './native-config.js';

export type NativeApi = Pick<TavusClient, 'createTool' | 'createPal' | 'getPal' | 'attachTools' | 'getPalTools' | 'createConversation' | 'getConversation' | 'endConversation'>;
interface ConfigRecord { hash: string; toolIds: string[]; palId?: string; pending?: 'tool' | 'pal'; unknown: boolean }
interface RoomRecord { sessionId: string; expiresAt: number; conversationId?: string; pending: boolean; unknown: boolean; closing: boolean; ended: boolean }
interface Ledger { version: 1; configs: ConfigRecord[]; rooms: RoomRecord[] }
const nonempty = (s: unknown): s is string => typeof s === 'string' && !!s && s.length <= 256;

// Stable PAL/Tools are retained; only per-session Conversations are ended.
export class NativeResources {
  private data: Ledger = { version: 1, configs: [], rooms: [] }; private writing = Promise.resolve();
  private configuring?: Promise<string>; private creating = new Map<string, Promise<unknown>>();
  private cleaning = new Map<string, Promise<boolean>>();
  constructor(readonly path: string, private api: NativeApi, readonly config: NativeConfiguration) {}
  async load() {
    let raw: unknown;
    try { raw = JSON.parse(await readFile(this.path, 'utf8')); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw new Error('native_ledger_invalid'); }
    const d = raw as Ledger;
    if (!d || d.version !== 1 || Object.keys(d).some(k => !['version', 'configs', 'rooms'].includes(k))
      || !Array.isArray(d.configs) || !Array.isArray(d.rooms) || d.configs.length > 32 || d.rooms.length > 400) throw new Error('native_ledger_invalid');
    for (const c of d.configs) if (!c || !/^[a-f0-9]{64}$/u.test(c.hash) || !Array.isArray(c.toolIds) || c.toolIds.length > 3
      || !c.toolIds.every(nonempty) || (c.palId !== undefined && !nonempty(c.palId)) || typeof c.unknown !== 'boolean'
      || (c.pending !== undefined && !['tool', 'pal'].includes(c.pending))
      || Object.keys(c).some(k => !['hash', 'toolIds', 'palId', 'pending', 'unknown'].includes(k))) throw new Error('native_ledger_invalid');
    for (const r of d.rooms) if (!r || !nonempty(r.sessionId) || !Number.isFinite(r.expiresAt) || r.expiresAt <= 0
      || (r.conversationId !== undefined && !nonempty(r.conversationId)) || !['pending', 'unknown', 'closing', 'ended'].every(k => typeof r[k as keyof RoomRecord] === 'boolean')
      || Object.keys(r).some(k => !['sessionId', 'expiresAt', 'conversationId', 'pending', 'unknown', 'closing', 'ended'].includes(k))
      || (r.ended && (r.pending || r.unknown))) throw new Error('native_ledger_invalid');
    if (new Set(d.configs.map(c => c.hash)).size !== d.configs.length || new Set(d.rooms.map(r => r.sessionId)).size !== d.rooms.length
      || new Set(d.rooms.flatMap(r => r.conversationId ? [r.conversationId] : [])).size !== d.rooms.filter(r => r.conversationId).length) throw new Error('native_ledger_invalid');
    this.data = structuredClone(d);
    for (const c of this.data.configs) if (c.pending) c.unknown = true;
    for (const r of this.data.rooms) if (r.pending) r.unknown = true;
  }
  private save() {
    const bytes = JSON.stringify(this.data, null, 2);
    const task = this.writing.then(async () => { await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      await writeFile(`${this.path}.tmp`, bytes, { mode: 0o600 }); await rename(`${this.path}.tmp`, this.path); });
    this.writing = task.catch(() => {}); return task;
  }
  view() { return structuredClone({ configs: this.data.configs, rooms: this.data.rooms }); }
  private assertReconciled() {
    if (this.data.configs.some(c => c.unknown) || this.data.rooms.some(r => r.unknown)) throw new Error('native_resources_require_reconciliation');
  }
  private async configuration() {
    this.assertReconciled();
    let c = this.data.configs.find(x => x.hash === this.config.hash);
    if (!c) { if (this.data.configs.length >= 32) throw new Error('native_configuration_limit');
      c = { hash: this.config.hash, toolIds: [], unknown: false }; this.data.configs.push(c); }
    for (let i = c.toolIds.length; i < this.config.tools.length; i++) {
      c.pending = 'tool'; await this.save();
      try { const tool = await this.api.createTool(this.config.tools[i]!); c.toolIds.push(tool.tool_id); c.pending = undefined; await this.save(); }
      catch (e) { c.unknown = !(e instanceof TavusError) || e.outcomeUnknown; c.pending = undefined; await this.save(); throw e; }
    }
    if (!c.palId) {
      c.pending = 'pal'; await this.save();
      try { const pal = await this.api.createPal(this.config.pal); c.palId = pal.pal_id; c.pending = undefined; await this.save(); }
      catch (e) { c.unknown = !(e instanceof TavusError) || e.outcomeUnknown; c.pending = undefined; await this.save(); throw e; }
    }
    const pal = await this.api.getPal(c.palId);
    const llm = (pal.layers as { llm?: Record<string, unknown> } | undefined)?.llm;
    if (pal.pal_id !== c.palId || pal.pipeline_mode !== 'full' || pal.default_face_id !== this.config.pal.default_face_id
      || llm?.model !== 'tavus-gemma-4' || llm?.base_url) throw new Error('native_pal_config_mismatch');
    await this.api.attachTools(c.palId, c.toolIds);
    const attached = await this.api.getPalTools(c.palId);
    const ids = Array.isArray(attached.data) ? attached.data.map((t: { tool_id?: unknown }) => t.tool_id) : [];
    if (!c.toolIds.every(id => ids.includes(id))) throw new Error('native_tools_not_attached');
    return c.palId;
  }
  private configured() {
    if (!this.configuring) { const task = this.configuration(); this.configuring = task; void task.catch(() => { if (this.configuring === task) this.configuring = undefined; }); }
    return this.configuring;
  }
  async create(sessionId: string, expiresAt: number, context: string, greeting: string, valid: () => boolean) {
    this.assertReconciled();
    if (this.data.rooms.some(r => r.sessionId === sessionId)) throw new Error('native_session_already_created');
    if (this.data.rooms.filter(r => !r.ended).length >= 2) throw new Error('native_room_limit');
    this.data.rooms = this.data.rooms.filter(r => !r.ended || r.expiresAt + 86400000 > Date.now());
    if (this.data.rooms.length >= 400) throw new Error('native_ledger_capacity');
    const r: RoomRecord = { sessionId, expiresAt, pending: false, unknown: false, closing: false, ended: false };
    this.data.rooms.push(r);
    const task = (async () => {
      await this.save(); const palId = await this.configured();
      if (r.closing || !valid()) throw new Error('native_start_cancelled');
      r.pending = true; await this.save();
      if (r.closing || !valid()) { r.pending = false; await this.save(); throw new Error('native_start_cancelled'); }
      try {
        const room = await this.api.createConversation({ pal_id: palId, face_id: this.config.pal.default_face_id,
          conversation_name: `Ask Kai ${sessionId}`, require_auth: true, max_participants: 2, audio_only: false,
          conversational_context: context, custom_greeting: greeting, dynamic_greeting: false, participant_tags: [],
          callback_url: `${this.config.base}/hooks/tavus/conversation`, properties: { languages: ['zh', 'en'], max_call_duration: 900,
            participant_left_timeout: 10, participant_absent_timeout: 60, enable_closed_captions: true, enable_recording: false, auto_start_recording: false } });
        r.conversationId = room.conversation_id; r.pending = false; await this.save();
        if (r.closing || !valid()) throw new Error('native_start_cancelled');
        if (!room.meeting_token || !/^https:\/\//u.test(room.conversation_url)) throw new Error('native_join_credentials_missing');
        return room;
      } catch (e) {
        if (!r.conversationId) { r.unknown = !(e instanceof TavusError) || e.outcomeUnknown; r.pending = false; await this.save(); }
        throw e;
      }
    })();
    this.creating.set(sessionId, task);
    try { return await task; } finally { this.creating.delete(sessionId); }
  }
  cleanup(sessionId: string): Promise<boolean> {
    const r = this.data.rooms.find(x => x.sessionId === sessionId); if (!r) return Promise.resolve(true);
    r.closing = true;
    const existing = this.cleaning.get(sessionId); if (existing) return existing;
    const task = (async () => {
      await this.save(); await this.creating.get(sessionId)?.catch(() => {});
      if (r.unknown || r.pending) return false;
      if (!r.conversationId) { r.ended = true; await this.save(); return true; }
      try {
        if ((await this.api.getConversation(r.conversationId)).status !== 'ended') await this.api.endConversation(r.conversationId);
        r.ended = (await this.api.getConversation(r.conversationId)).status === 'ended'; await this.save(); return r.ended;
      } catch { return false; }
    })();
    this.cleaning.set(sessionId, task); void task.finally(() => this.cleaning.delete(sessionId)).catch(() => {}); return task;
  }
  async recover() { for (const r of this.data.rooms.filter(r => !r.ended)) await this.cleanup(r.sessionId); }
  async sweep(now = Date.now()) { for (const r of this.data.rooms.filter(r => !r.ended && (r.closing || r.expiresAt <= now))) await this.cleanup(r.sessionId); }
  async confirmedEnd(conversationId: string) {
    const r = this.data.rooms.find(r => r.conversationId === conversationId);
    if (!r || r.ended) return !!r?.ended;
    if ((await this.api.getConversation(conversationId)).status !== 'ended') return false;
    r.ended = true; r.closing = true; await this.save(); return true;
  }
}
