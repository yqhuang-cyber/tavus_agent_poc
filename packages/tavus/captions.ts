export interface Caption {
  inferenceId: string; role: 'pal' | 'user'; text: string; contentIndex: number; seq: number;
  final: boolean; interrupted: boolean; sourceRole: string; presentation: 'unknown';
}
export interface ConversationEvent {
  message_type: string; event_type: string; conversation_id: string;
  inference_id?: string; seq?: number;
  properties?: { role?: string; speech?: string; content_index?: number; final?: boolean; is_interrupted?: boolean; interrupted?: boolean };
}

// Browser reports are not authenticated supplier playback receipts. This reducer
// produces caption snapshots only; it cannot award learning/presentation evidence.
export class Captions {
  private items = new Map<string, Caption>();
  private blocked = new Set<string>();
  constructor(private conversationId: string) {}
  interrupt(inferenceId: string) { this.blocked.add(inferenceId); }
  ingest(event: ConversationEvent): Caption | undefined {
    if (event.message_type !== 'conversation' || event.conversation_id !== this.conversationId || !event.inference_id || this.blocked.has(event.inference_id)) return;
    if (!['conversation.utterance.streaming', 'conversation.utterance'].includes(event.event_type)) return;
    const p = event.properties;
    if (!p || !['user', 'pal', 'replica'].includes(p.role ?? '') || typeof p.speech !== 'string') return;
    const streaming = event.event_type.endsWith('.streaming');
    const role = p.role === 'replica' ? 'pal' : p.role as 'pal' | 'user';
    const key = `${event.inference_id}:${role}`;
    const old = this.items.get(key);
    const index = p.content_index ?? old?.contentIndex ?? 0;
    const seq = event.seq ?? old?.seq ?? 0;
    if (old) {
      if (old.sourceRole === 'pal' && p.role === 'replica') return;
      if (index < old.contentIndex || seq < old.seq || (old.final && streaming && !p.final)) return;
      if (old.interrupted && !streaming) return; // Full draft may include unspoken content.
      if (seq === old.seq && index === old.contentIndex && p.speech === old.text && p.role === old.sourceRole && p.final === old.final) return;
    }
    if (!streaming && p.interrupted === true) {
      this.blocked.add(event.inference_id);
      if (!old) return; // A full interrupted draft has no known spoken prefix.
      const interrupted = { ...old, interrupted: true, final: true, seq };
      this.items.set(key, interrupted);
      return structuredClone(interrupted);
    }
    const caption: Caption = { inferenceId: event.inference_id, role, text: p.speech, contentIndex: index, seq,
      final: !streaming || p.final === true, interrupted: streaming ? p.is_interrupted === true : p.interrupted === true,
      sourceRole: p.role!, presentation: 'unknown' };
    this.items.set(key, caption);
    if (caption.interrupted) this.blocked.add(event.inference_id);
    return structuredClone(caption);
  }
  snapshot() { return [...this.items.values()].map(c => structuredClone(c)); }
}
