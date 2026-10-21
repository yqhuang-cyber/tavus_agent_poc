import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { writeOfflineReport } from '../packages/verification/reports.js';
import { createGateway } from '../apps/gateway/server.js';
import { PiTutor, fixturePiOptions } from '../packages/tutor/runtime.js';
import { readSse } from '../packages/tavus/sse.js';
import { dimensions, evaluationCases, expectedTeachingStates } from '../eval/scenarios.js';

const token = randomBytes(32).toString('base64url');
const gateway = createGateway({ operatorToken: token, modelMode: 'fixture', tutor: new PiTutor(fixturePiOptions()) });
await new Promise<void>(resolve => gateway.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${(gateway.server.address() as AddressInfo).port}`;
const operator = (path: string, data?: unknown) => fetch(base + path, { method: data === undefined ? 'GET' : 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
const cases = evaluationCases();
const results: { caseId: string; protocol: string; summarySources: string; teachingState: string; semanticReview: string; scores: Record<string, null> }[] = [];
try {
  // Two independent cases at a time, within the POC concurrency budget.
  for (let index = 0; index < cases.length; index += 2) {
    await Promise.all(cases.slice(index, index + 2).map(async c => {
      const started = await operator('/internal/sessions', { fixture: c.fixture }); assert.equal(started.status, 201);
      const session = await started.json();
      const messages: { role: string; content: string }[] = [];
      for (const [turnIndex, input] of c.scenario.inputs.entries()) {
        messages.push({ role: 'user', content: input });
        const response = await fetch(base + '/v1/chat/completions', { method: 'POST',
          headers: { 'x-askkai-session-key': session.gateway_credential, 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'ask-kai-pi', stream: true, input_modality: 'text', messages }) });
        assert.equal(response.status, 200); assert.ok(response.body);
        let done = false; let text = '';
        for await (const data of readSse(response.body)) {
          if (data === '[DONE]') { done = true; continue; }
          text += JSON.parse(data).choices[0].delta.content ?? '';
        }
        assert.ok(done && text.trim()); messages.push({ role: 'assistant', content: text });
        const diagnostic = await (await operator(`/internal/sessions/${session.session_id}`)).json();
        const expected = expectedTeachingStates[c.scenario.id]?.[turnIndex]; assert.ok(expected);
        for (const [field, value] of Object.entries(expected)) assert.equal(diagnostic.teaching[field], value, `${c.id}:${turnIndex}:${field}`);
      }
      const end = await operator(`/internal/sessions/${session.session_id}/end`, {}); assert.equal(end.status, 200);
      const summary = (await end.json()).summary;
      assert.equal(summary.attempts.length, 0); assert.equal(summary.save.status, 'not_requested');
      assert.equal(summary.excerpts.length, c.scenario.inputs.length);
      for (const excerpt of summary.excerpts) assert.ok(c.scenario.inputs.includes(excerpt.quote));
      assert.equal(summary.presentation, 'unknown');
      results.push({ caseId: c.id, protocol: 'passed', summarySources: 'passed', teachingState: 'passed', semanticReview: 'not-run',
        scores: Object.fromEntries(dimensions.map(d => [d, null])) });
    }));
  }
  const report = { timestamp: new Date().toISOString(), kind: 'offline-synthetic', model: 'synthetic-offline',
    scenario_origin: 'local-prd-draft', source_baseline_alignment: 'pending-original-E01-E09',
    case_count: results.length, protocol_passed: results.filter(r => r.protocol === 'passed').length,
    teaching_state_passed: results.filter(r => r.teachingState === 'passed').length,
    completed_turns: cases.reduce((total, c) => total + c.scenario.inputs.length, 0),
    teaching_quality: 'not-evaluated', real_supplier: 'not-run', real_media: 'not-run', results: results.sort((a, b) => a.caseId.localeCompare(b.caseId)) };
  const reportPath = await writeOfflineReport('eval-offline.json', report);
  console.log(JSON.stringify({ kind: report.kind, case_count: report.case_count, protocol_passed: report.protocol_passed,
    teaching_state_passed: report.teaching_state_passed,
    completed_turns: report.completed_turns, teaching_quality: report.teaching_quality, source_baseline_alignment: report.source_baseline_alignment,
    report: reportPath }, null, 2));
} finally { await gateway.close(); }
