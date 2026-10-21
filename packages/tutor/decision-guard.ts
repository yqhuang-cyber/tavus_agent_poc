import { actions, type Decision } from './policy.js';
import type { TeachingState } from './teaching-state.js';

export function guardDecision(proposed: Decision, state: TeachingState, currentInput: string) {
  if (!actions.includes(proposed.action)) throw new Error('invalid_proposed_action');
  const replace = (action: Decision['action'], code: string) => ({
    decision: { action, reason: code, source: 'policy-guard' as const }, proposedAction: proposed.action, guards: [code],
  });
  if (state.current.closeRequested && proposed.action !== 'CLOSE') return replace('CLOSE', 'current_close_request');
  if (proposed.action === 'INVITE_PRACTICE' && state.practice.mode === 'declined') return replace('RESPOND', 'practice_declined');
  if (proposed.action === 'CORRECT') {
    if (state.correction.mode === 'off') return replace('RESPOND', 'correction_disabled');
    const c = proposed.correction;
    if (!c || c.kind !== 'wording' || !c.quote.trim() || !c.replacement.trim() || c.quote.length > 240 || c.replacement.length > 240
      || c.quote === c.replacement || !currentInput.includes(c.quote)) return replace('RESPOND', 'correction_without_current_source');
  }
  return { decision: structuredClone(proposed), proposedAction: proposed.action, guards: [] as string[] };
}
