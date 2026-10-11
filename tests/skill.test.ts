import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { loadSkillsFromDir } from '@earendil-works/pi-coding-agent';
import { Value } from 'typebox/value';
import { ReviewInputSchema } from '../src/schema.js';
import { prepareCommand } from '../src/invocation.js';

const path = resolve('skills/claude-code-review');
const skill = await readFile(resolve(path, 'SKILL.md'), 'utf8');

test('Pi discovers wrapper skill with no diagnostics', () => {
  const discovery = loadSkillsFromDir({ dir: path, source: 'test' });
  assert.deepEqual(discovery.diagnostics, []);
  assert.equal(discovery.skills.length, 1);
  assert.equal(discovery.skills[0]!.name, 'claude-code-review');
  assert.match(discovery.skills[0]!.description, /built-in.*claude_code_review/);
});

test('skill request examples select expected typed commands and default/explicit effort', async () => {
  const examples = [...skill.matchAll(/```json\n([\s\S]*?)\n```/g)].map(match => JSON.parse(match[1]!));
  const commands = [
    '/code-review medium',
    '/code-review high https://github.com/owner/project/pull/123',
    '/code-review medium --max-findings all https://github.com/owner/project/pull/123',
    '/code-review xhigh --max-findings 3 baseline...HEAD',
    '/code-review medium --max-findings default src/',
  ];
  assert.equal(examples.length, commands.length);
  for (const [index, input] of examples.entries()) {
    assert.ok(Value.Check(ReviewInputSchema, input));
    const prepared = await prepareCommand(input, { cwd: tmpdir(), deadline: Date.now() + 1000, ghExecutable: '/must/not/run' });
    assert.equal(prepared.command, commands[index]);
    assert.equal(prepared.input.effortSource, input.effort ? 'user-supplied' : 'defaulted');
    assert.equal(prepared.input.fix, false);
    assert.equal(prepared.input.comment, false);
  }
  assert.match(skill, /Ask whether ambiguous text names a branch or path/);
  assert.match(skill, /Keep it separate from target arguments/);
});
