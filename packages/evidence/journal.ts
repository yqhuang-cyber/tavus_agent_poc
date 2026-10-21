import { createHash, randomUUID } from 'node:crypto';

export class EvidenceError extends Error {}
export type InputModality = 'text' | 'audio_transcript' | 'unknown';
export interface EvidenceRef {
  sessionId: string; responseId: string; turnId: string;
  stateVersion: number; consentVersion: number; contextVersion: number; connectionEpoch: number;
}
export interface InputEvidence extends EvidenceRef {
  id: string; text: string; modality: InputModality; provenance: 'gateway-input' | 'synthetic-input' | 'client-reported';
  assessment: 'not_assessed';
}
export interface Selection { id: string; kind: 'topic' | 'attempt'; evidenceId: string; quote: string }
export type CloseReason = 'user_end' | 'expired' | 'shutdown' | 'provider_end' | 'failed';
export interface EvidenceSnapshot {
  id: string; sessionId: string; cutoffVersion: number; consentVersion: number; contextVersion: number; connectionEpoch: number;
  journalVersion: number; reason: CloseReason; completeness: 'complete' | 'partial';
  inputs: InputEvidence[]; selections: Selection[]; coverage: 'accepted-inputs-only'; presentation: 'unknown';
}

// Only accepted learner input is evidence. Model actions/drafts, captions, and
// unsigned callbacks have no API here for creating learning facts.
export class EvidenceJournal {
  private inputs = new Map<string, InputEvidence>();
  private selections: Selection[] = [];
  private version = 0;
  private frozen?: EvidenceSnapshot;
  constructor(private sessionId: string) {}
  record(ref: EvidenceRef, text: string, modality: InputModality, synthetic: boolean) {
    if (this.frozen) throw new EvidenceError('evidence_frozen');
    if (ref.sessionId !== this.sessionId || !text.trim() || text.length > 8000 || !['text', 'audio_transcript', 'unknown'].includes(modality)) throw new EvidenceError('invalid_input_evidence');
    if (!synthetic && modality !== 'unknown') throw new EvidenceError('unverified_input_modality');
    const evidence: InputEvidence = { ...ref, id: randomUUID(), text, modality,
      provenance: synthetic ? 'synthetic-input' : 'gateway-input', assessment: 'not_assessed' };
    this.inputs.set(ref.turnId, evidence); // Last accepted revision replaces prior references.
    this.version++;
    return structuredClone(evidence);
  }
  recordClientInput(ref: EvidenceRef, text: string, modality: 'text' | 'audio_transcript') {
    if (!['text', 'audio_transcript'].includes(modality)) throw new EvidenceError('invalid_client_input_modality');
    // A separately named entry point preserves the weaker provenance of browser reports.
    const result = this.record(ref, text, 'unknown', false);
    const source = this.inputs.get(ref.turnId)!;
    source.modality = modality; source.provenance = 'client-reported';
    return structuredClone({ ...result, modality, provenance: 'client-reported' as const });
  }
  select(kind: Selection['kind'], evidenceId: string, quote: string) {
    if (this.frozen) throw new EvidenceError('evidence_frozen');
    if (!['topic', 'attempt'].includes(kind)) throw new EvidenceError('invalid_selection_kind');
    const source = [...this.inputs.values()].find(i => i.id === evidenceId);
    if (!source || !quote.trim() || quote.length > 120 || !source.text.includes(quote)) throw new EvidenceError('unsupported_evidence_quote');
    const existing = this.selections.find(s => s.kind === kind && s.evidenceId === evidenceId && s.quote === quote);
    if (existing) return structuredClone(existing);
    if (this.selections.length >= 100) throw new EvidenceError('selection_budget');
    const selection = { id: randomUUID(), kind, evidenceId, quote };
    this.selections.push(selection); this.version++;
    return structuredClone(selection);
  }
  inspect() {
    const inputs = [...this.inputs.values()];
    const valid = new Set(inputs.map(i => i.id));
    return structuredClone({ version: this.version, frozen: !!this.frozen, inputs,
      selections: this.selections.filter(s => valid.has(s.evidenceId)) });
  }
  preview(cutoff: Omit<EvidenceRef, 'turnId' | 'responseId' | 'stateVersion'> & { cutoffVersion: number }, reason: CloseReason, complete: boolean) {
    if (this.frozen) return structuredClone(this.frozen);
    if (cutoff.sessionId !== this.sessionId) throw new EvidenceError('snapshot_session_mismatch');
    const { inputs, selections } = this.inspect();
    const data = { ...cutoff, journalVersion: this.version, reason, inputs, selections,
      completeness: complete ? 'complete' as const : 'partial' as const, coverage: 'accepted-inputs-only' as const, presentation: 'unknown' as const };
    return structuredClone({ id: createHash('sha256').update(JSON.stringify(data)).digest('hex'), ...data });
  }
  freeze(cutoff: Omit<EvidenceRef, 'turnId' | 'responseId' | 'stateVersion'> & { cutoffVersion: number }, reason: CloseReason, complete: boolean) {
    this.frozen ??= this.preview(cutoff, reason, complete);
    return structuredClone(this.frozen);
  }
}
