import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { canonicalPrUrl, lookupRepository, resolveTarget } from '../src/targets.js';
import type { TargetEnvironment } from '../src/targets.js';

async function fakeGh(mode: string, run: (env: TargetEnvironment, capture: string) => Promise<void>) {
  const cwd = await mkdtemp(join(tmpdir(), 'review-gh-'));
  const capture = join(cwd, 'capture.json');
  const executable = join(cwd, 'gh.cjs');
  await writeFile(executable, `#!${process.execPath}\nconst fs=require('node:fs');\nfs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()}));\n${mode}\n`, { mode: 0o700 });
  try { await run({ cwd, deadline: Date.now() + 10000, ghExecutable: executable }, capture); }
  finally { await rm(cwd, { recursive: true, force: true }); }
}

test('explicit repository works without a checkout or gh lookup', async () => {
  const env = { cwd: tmpdir(), deadline: Date.now() + 10000, ghExecutable: '/does/not/exist' };
  assert.equal(await resolveTarget({ kind: 'pr', number: 123, repository: 'owner/project' }, env), 'https://github.com/owner/project/pull/123');
  assert.equal(await resolveTarget({ kind: 'pr-url', url: 'https://github.com/owner/project/pull/123/' }, env), 'https://github.com/owner/project/pull/123');
  assert.equal(await resolveTarget(undefined, env), undefined);
  assert.equal(await resolveTarget({ kind: 'branch', value: 'a...b' }, env), 'a...b');
  assert.equal(await resolveTarget({ kind: 'path', value: 'sample.py' }, env), 'sample.py');
});

test('numeric PR infers repository via exact read-only argv and selected cwd', async () => {
  await fakeGh(`console.log(JSON.stringify({nameWithOwner:'owner/project'}));`, async (env, capture) => {
    assert.equal(await resolveTarget({ kind: 'pr', number: 123 }, env), 'https://github.com/owner/project/pull/123');
    assert.deepEqual(JSON.parse(await readFile(capture, 'utf8')), { args: ['repo', 'view', '--json', 'nameWithOwner'], cwd: env.cwd });
  });
});

for (const mode of [
  `console.error('not a git repository'); process.exit(1);`,
  `console.error('authentication required'); process.exit(1);`,
  `console.log('malformed json');`, `console.log('{}');`,
  `console.log(JSON.stringify({nameWithOwner:'bad/repo/extra'}));`,
  `console.log('x'.repeat(10000));`, `setInterval(()=>{},1000);`,
]) {
  test(`repository lookup failure: ${mode}`, async () => {
    await fakeGh(mode, async env => {
      await assert.rejects(resolveTarget({ kind: 'pr', number: 123 }, env), /Repository.*(context|lookup)/);
    });
  });
}

test('missing gh reports explicit repository guidance', async () => {
  await assert.rejects(lookupRepository({ cwd: tmpdir(), deadline: Date.now() + 1000, ghExecutable: '/does/not/exist' }), /Supply target.repository/);
});

test('target preparation observes cancellation and the total deadline', async () => {
  const signal = AbortSignal.abort();
  await assert.rejects(resolveTarget(undefined, { cwd: tmpdir(), deadline: Date.now() + 1000, signal }), /abort/i);
  await assert.rejects(resolveTarget(undefined, { cwd: tmpdir(), deadline: Date.now() - 1 }), /deadline/);
  await fakeGh(`setInterval(()=>{},1000);`, async env => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 100);
    try { await assert.rejects(lookupRepository({ ...env, signal: controller.signal }), /Lookup failed/); }
    finally { clearTimeout(timer); }
  });
});

for (const url of [
  'http://github.com/o/r/pull/1', 'https://example.com/o/r/pull/1',
  'https://github.com/o/r', 'https://github.com/o/r/pull/0',
  'https://github.com/o/r/pull/-1', 'https://github.com/o/r/pull/01',
  'https://github.com/o/r/pull/1?x=1', 'https://github.com/o/r/pull/1#review',
  'https://user@github.com/o/r/pull/1', 'https://github.com:443/o/r/pull/1',
  'https://github.com/o/r/../r/pull/1', 'https://github.com/o/%72/pull/1',
  'https://github.com/o/r/pull/1\n--fix', 'https://github.com/o/r/pull/1\n',
  'https://github.com/o/r/pull/9007199254740992', 'https://gitlab.com/o/r/-/merge_requests/1',
]) {
  test(`reject malformed or unsupported PR URL ${JSON.stringify(url)}`, () => {
    assert.throws(() => canonicalPrUrl(url), /PR URL|repository/);
  });
}
