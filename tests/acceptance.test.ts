import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import test from 'node:test';

test('acceptance matrix covers every delta-spec requirement and names existing tests', async () => {
  const spec = await readFile(new URL('../openspec/changes/add-claude-code-review-wrapper/specs/claude-code-review/spec.md', import.meta.url), 'utf8');
  const matrix = await readFile(new URL('../docs/acceptance-matrix.md', import.meta.url), 'utf8');
  const requirements = [...spec.matchAll(/^### Requirement: (.+)$/gm)].map(match => match[1]!);
  assert.equal(requirements.length, 12);
  for (const requirement of requirements) assert.ok(matrix.includes(`| ${requirement} |`), requirement);
  const tests = [...matrix.matchAll(/`([\w-]+\.test\.ts)`/g)].map(match => match[1]!);
  for (const path of new Set(tests)) await access(new URL(path, import.meta.url));
  assert.match(matrix, /neither production credentials nor external writes/);
});
