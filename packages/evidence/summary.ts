import type { EvidenceSnapshot, InputEvidence } from './journal.js';

export interface SummaryItem { quote: string; evidenceId: string; turnId: string; inputVersion: number }
export interface AttemptItem extends SummaryItem {
  kind: 'typed_attempt' | 'transcript_candidate'; label: string;
  assessment: 'not_assessed'; pronunciation: 'unverified';
}
export interface SessionSummary {
  id: string; sessionId: string; cutoffVersion: number; consentVersion: number; contextVersion: number; connectionEpoch: number;
  completeness: 'complete' | 'partial'; coverage: 'accepted-inputs-only'; presentation: 'unknown';
  topics: SummaryItem[]; excerpts: SummaryItem[]; attempts: AttemptItem[]; candidates: AttemptItem[];
  note: string; oralReview: string; limitations: string[];
}

function item(input: InputEvidence, quote: string): SummaryItem {
  if (!quote || !input.text.includes(quote)) throw new Error('summary_quote_without_source');
  return { quote, evidenceId: input.id, turnId: input.turnId, inputVersion: input.stateVersion };
}

// Deterministic extractive summary. No model self-rating, inferred mastery, or
// unsourced topic labels. Oral/card views use this exact same frozen snapshot.
export function buildSummary(snapshot: EvidenceSnapshot): SessionSummary {
  const sources = new Map(snapshot.inputs.map(i => [i.id, i]));
  const topics: SummaryItem[] = []; const attempts: AttemptItem[] = []; const candidates: AttemptItem[] = [];
  for (const s of snapshot.selections) {
    const input = sources.get(s.evidenceId);
    if (!input || input.sessionId !== snapshot.sessionId) throw new Error('summary_source_missing');
    const ref = item(input, s.quote);
    if (s.kind === 'topic') topics.push(ref);
    else {
      const typed = input.modality === 'text';
      (typed ? attempts : candidates).push({ ...ref, kind: typed ? 'typed_attempt' : 'transcript_candidate',
        label: typed ? '文字表达尝试' : '转写候选，尚未核验口语', assessment: 'not_assessed', pronunciation: 'unverified' });
    }
  }
  const excerpts = snapshot.inputs.slice(-5).map(i => item(i, i.text.slice(0, 120)));
  const note = !snapshot.inputs.length ? '本次没有可引用的交流记录。'
    : attempts.length ? '本次记录了文字表达尝试，未评定掌握或发音。' : '本次以交流为主。';
  const mentions = (topics.length ? topics : excerpts).slice(0, 2).map(i => `“${i.quote}”`).join('、');
  return { id: snapshot.id, sessionId: snapshot.sessionId, cutoffVersion: snapshot.cutoffVersion,
    consentVersion: snapshot.consentVersion, contextVersion: snapshot.contextVersion, connectionEpoch: snapshot.connectionEpoch,
    completeness: snapshot.completeness, coverage: snapshot.coverage, presentation: 'unknown',
    topics, excerpts, attempts, candidates, note,
    oralReview: `${mentions ? `今天你提到了${mentions}。` : ''}${note}`,
    limitations: ['仅引用已接受的输入，不能据转写评定发音或掌握。', '老师的实际播放范围未知。',
      ...(candidates.length ? ['转写候选不计入已核验的练习。'] : []),
      ...(snapshot.completeness === 'partial' ? ['本次记录不完整。'] : [])] };
}
