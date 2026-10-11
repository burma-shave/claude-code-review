import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Captured upstream evidence only. These tests never launch Claude or spend usage.
for (const name of ['current-diff', 'context', 'whitespace', 'reserved-path', 'range', 'collision']) {
  test(`installed 2.1.296 ${name} envelope is retained as observed`, async () => {
    const result = JSON.parse(await readFile(new URL(`./fixtures/smoke-2.1.296-${name}.json`, import.meta.url), 'utf8'));
    assert.equal(result.type, 'result');
    assert.equal(result.is_error, false);
    assert.equal(result.subtype, 'success');
    assert.equal(typeof result.result, 'string');
    assert.equal(result.subagent_stats.spawned, 0);
    if (name === 'collision') {
      assert.equal(result.result, 'CUSTOM_SKILL_COLLISION_296');
      assert.equal(result.local_command, undefined);
    } else {
      assert.equal(result.local_command, 'code_review');
    }
  });
}
