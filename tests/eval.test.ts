import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dimensions, evaluationCases, expectedTeachingStates, scenarios } from '../eval/scenarios.js';

test('local draft matrix covers all four profiles, nine scenarios and PRD teaching rules without claiming source baseline', () => {
  const cases = evaluationCases(); assert.equal(cases.length, 36); assert.equal(new Set(cases.map(c => c.id)).size, 36);
  assert.equal(new Set(cases.map(c => c.fixture)).size, 4); assert.equal(scenarios.length, 9);
  assert.deepEqual(new Set(scenarios.flatMap(s => s.rules)), new Set(Array.from({ length: 10 }, (_, i) => `T${String(i + 1).padStart(2, '0')}`)));
  assert.ok(cases.every(c => c.baseline === 'source-E01-E09-unavailable' && c.scenario.id.startsWith('LOCAL-') && c.scenario.review.length > 0));
  assert.equal(dimensions.length, 10);
  assert.ok(scenarios.every(s => expectedTeachingStates[s.id]?.length === s.inputs.length));
});
