export type FixtureId = 'alex' | 'maya' | 'leo' | 'nina';
export interface LearnerContext {
  fixtureId: FixtureId;
  source: 'synthetic';
  version: number;
  consentVersion: number;
  coverage: 'mock-only';
  profile: { name: string; level: string };
  preferences: { chineseOnly: boolean; speed: 'normal' | 'slow' };
  learningGoals: string[];
  saveAllowed: boolean;
}

const profiles = {
  alex: { name: 'Alex', level: 'HSK1' },
  maya: { name: 'Maya', level: 'HSK3' },
  leo: { name: 'Leo', level: 'HSK5' },
  nina: { name: 'Nina', level: 'HSK7' },
} as const;

// Only the operator-only M0 probe selects fixtures. A production adapter must derive
// learner ownership and consent from a trusted business identity.
export function getMockContext(id: string, mockSaveAllowed = false): LearnerContext {
  if (!Object.hasOwn(profiles, id)) throw new Error('unknown_fixture');
  return structuredClone({
    fixtureId: id as FixtureId, source: 'synthetic', version: 1,
    consentVersion: 1, coverage: 'mock-only', profile: profiles[id as FixtureId],
    preferences: { chineseOnly: false, speed: 'normal' }, learningGoals: [], saveAllowed: mockSaveAllowed,
  });
}
