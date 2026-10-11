import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('manifest explicitly selects the planned extension and skill', () => {
  assert.deepEqual(manifest.pi, {
    extensions: ['./extensions/code-review.ts'],
    skills: ['./skills/claude-code-review'],
  });
  assert.ok(manifest.keywords.includes('pi-package'));
  assert.equal(manifest.type, 'module');
});

test('declared resources and README local-load instructions match delivered files', () => {
  for (const resource of manifest.pi.extensions) assert.ok(existsSync(new URL(`../${resource}`, import.meta.url)));
  for (const resource of manifest.pi.skills) assert.ok(existsSync(new URL(`../${resource}/SKILL.md`, import.meta.url)));
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  for (const text of ['pi -e .', 'pi install /absolute/path/to/pi-claude-code-review', 'pi remove /absolute/path/to/pi-claude-code-review', '/skill:claude-code-review', 'project trust', 'No context is appended to the target']) assert.ok(readme.includes(text));
  assert.ok(!readme.includes('not yet delivered'));
});

test('host packages are peers, not bundled runtime dependencies', () => {
  for (const name of ['@earendil-works/pi-coding-agent', 'typebox']) {
    assert.equal(manifest.peerDependencies[name], '*');
    assert.equal(manifest.dependencies?.[name], undefined);
    assert.equal(manifest.devDependencies?.[name], undefined);
  }
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  for (const path of Object.keys(lock.packages)) {
    assert.doesNotMatch(path, /node_modules\/(?:@earendil-works\/pi-[^/]+|typebox)$/);
  }
});
