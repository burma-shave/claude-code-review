import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from 'typebox/value';
import { normalizeInput } from '../src/inputs.js';
import { ResultSchema, resultMetadata, toolResult } from '../src/results.js';
import type { RunResult } from '../src/runner.js';

export function fixture(overrides: Partial<RunResult> = {}): RunResult {
  return {
    status: 'completed', input: normalizeInput({}), target: null, cwd: '/checkout',
    version: { status: 'unavailable', version: null, raw: '', diagnostic: null },
    durationMs: 10, exitCode: 0, exitSignal: null,
    logs: { directory: '/logs', stdout: '/logs/stdout.jsonl', stderr: '/logs/stderr.log' },
    text: 'One finding.', diagnostic: null, ...overrides,
  };
}

test('metadata schema matches defaults, selections, versions, and error statuses', () => {
  for (const status of ['completed', 'failed', 'cancelled', 'timed-out'] as const) {
    for (const input of [null, normalizeInput({}), normalizeInput({ target: { kind: 'pr', number: 123, repository: 'owner/repo' }, effort: 'high', fix: true, comment: true, maxFindings: 'all', context: 'private' })]) {
      const run = fixture({ status, input, diagnostic: status === 'completed' ? null : 'failure' });
      const output = toolResult(run);
      assert.ok(Value.Check(ResultSchema, output.structuredContent));
      assert.equal(output.isError, status !== 'completed');
      assert.equal(output.details, output.structuredContent);
      assert.ok(!JSON.stringify(output.details).includes('private'));
      assert.equal(output.details.options?.effortSource, input?.effortSource);
      assert.deepEqual(output.details.options?.findingLimit, input?.findingLimit);
    }
  }
  for (const version of [
    { status: 'reported' as const, version: '99.1.2', raw: '99.1.2 Claude', diagnostic: null },
    { status: 'unrecognized' as const, version: null, raw: 'future build', diagnostic: null },
  ]) assert.ok(Value.Check(ResultSchema, resultMetadata(fixture({ version }))));
  assert.equal(Value.Check(ResultSchema, { ...resultMetadata(fixture()), status: 'clean' }), false);
});
