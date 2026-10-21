import { createHash, randomBytes } from 'node:crypto';
import type { LearnerContext } from './context.js';

export class PreparationError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
interface Ticket { actor: string; context: LearnerContext; expiresAt: number; spent: boolean }
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

// M1 offline contract: trusted operator selects a synthetic authorized snapshot.
// Production identity/consent must come from the business adapter, not browser IDs.
export class PreparationTickets {
  private tickets = new Map<string, Ticket>();
  constructor(private now = Date.now) {}
  issue(context: LearnerContext, actor: string) {
    this.prune();
    if (!actor || context.source !== 'synthetic' || context.coverage !== 'mock-only') throw new PreparationError(403, 'mock_preparation_only');
    if ([...this.tickets.values()].filter(t => !t.spent && t.expiresAt > this.now()).length >= 16) throw new PreparationError(429, 'preparation_limit');
    const ticket = randomBytes(32).toString('base64url'); const expiresAt = this.now() + 60000;
    this.tickets.set(digest(ticket), { actor: digest(actor), context: structuredClone(context), expiresAt, spent: false });
    return { preparation_ticket: ticket, expires_at: expiresAt, status: 'prepared', media_ready: false, resources_created: false,
      source: 'synthetic', preferences: { chinese_only: context.preferences.chineseOnly }, consent_version: context.consentVersion };
  }
  redeem(ticket: string, actor: string) {
    this.prune();
    const entry = this.tickets.get(digest(ticket));
    if (!entry) throw new PreparationError(401, 'invalid_preparation_ticket');
    if (entry.actor !== digest(actor)) throw new PreparationError(403, 'preparation_actor_mismatch');
    if (entry.expiresAt <= this.now()) throw new PreparationError(410, 'preparation_expired');
    if (entry.spent) throw new PreparationError(409, 'preparation_already_used');
    // Consume synchronously before any model or resource creation can await.
    entry.spent = true;
    return structuredClone(entry.context);
  }
  private prune() {
    for (const [hash, t] of this.tickets) if (t.expiresAt + 60000 <= this.now()) this.tickets.delete(hash);
  }
  clear() { this.tickets.clear(); }
}
