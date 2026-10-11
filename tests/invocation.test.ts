import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { LOCAL_EFFORTS, normalizeInput } from '../src/inputs.js';
import { buildCommand, encodeTarget, prepareCommand } from '../src/invocation.js';

const environment = () => ({ cwd: tmpdir(), deadline: Date.now() + 5000, ghExecutable: '/must/not/run' });

for (const effort of [undefined, ...LOCAL_EFFORTS]) {
  for (const maxFindings of [undefined, 1, 12, 'all', 'default']) {
    test(`canonical default/current diff: effort=${effort}, limit=${maxFindings}`, () => {
      const input = normalizeInput({ effort, maxFindings });
      assert.equal(buildCommand(input), `/code-review ${effort ?? 'medium'}${maxFindings === undefined ? '' : ` --max-findings ${maxFindings}`}`);
      assert.equal(input.findingLimit.source, maxFindings === undefined ? 'inherited' : 'user-supplied');
      assert.equal(input.effortSource, effort === undefined ? 'defaulted' : 'user-supplied');
    });
  }
}

for (const [target, text] of [
  [{ kind: 'pr', number: 123, repository: 'owner/project' }, 'https://github.com/owner/project/pull/123'],
  [{ kind: 'pr-url', url: 'https://github.com/owner/project/pull/123/' }, 'https://github.com/owner/project/pull/123'],
  [{ kind: 'branch', value: 'main' }, 'main'],
  [{ kind: 'branch', value: 'baseline...HEAD' }, 'baseline...HEAD'],
  [{ kind: 'path', value: 'sample.py' }, 'sample.py'],
  [{ kind: 'path', value: 'folder with spaces/sample.py' }, 'folder with spaces/sample.py'],
  [{ kind: 'path', value: './high' }, './high'],
  [{ kind: 'path', value: 'src/' }, 'src/'],
  [{ kind: 'path', value: '/tmp/repo/sample.py' }, '/tmp/repo/sample.py'],
] as const) {
  test(`canonical target ${text}`, async () => {
    assert.equal((await prepareCommand({ target }, environment())).command, `/code-review medium ${text}`);
    assert.equal((await prepareCommand({ target, effort: 'high', fix: true, comment: true, maxFindings: 3 }, environment())).command,
      `/code-review high --fix --comment --max-findings 3 ${text}`);
  });
}

for (const fix of [false, true]) for (const comment of [false, true]) {
  test(`canonical side effects fix=${fix}, comment=${comment}`, () => {
    assert.equal(buildCommand(normalizeInput({ fix, comment })), `/code-review medium${fix ? ' --fix' : ''}${comment ? ' --comment' : ''}`);
  });
}

for (const value of [
  '', ' main', 'main ', '--fix', 'sample.py --comment', 'path\n/code-review ultra',
  'path\r--fix', 'path\t--fix', 'path\0', 'high', 'folder high file.py', 'all', 'default',
  '123', 'sample.py; echo hi', '$(touch x)', '`echo hi`', '"folder with spaces"',
  'résumé.py', 'file@name', 'https://github.com/o/r/pull/1',
]) {
  test(`reject unrepresentable target ${JSON.stringify(value)}`, () => {
    assert.throws(() => encodeTarget(value), /conservative slash-command encoding/);
  });
}

test('preserve accepted targets, do not typo-correct or silently change whitespace', () => {
  for (const value of ['smple.py', 'folder  with spaces/file.py', './123', 'feature/new-code']) assert.equal(encodeTarget(value), value);
});

test('command construction cannot silently drop a target or accept an arbitrary resolved PR string', () => {
  assert.throws(() => buildCommand(normalizeInput({ target: { kind: 'path', value: 'sample.py' } })), /must be resolved/);
  assert.throws(() => buildCommand(normalizeInput({}), 'sample.py'), /must be resolved/);
  assert.throws(() => buildCommand(normalizeInput({ target: { kind: 'pr', number: 1 } }), 'https://github.com/o/r/pull/1 --fix'), /PR URL/);
});
