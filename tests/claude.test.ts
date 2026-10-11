import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import {
  ClaudeSetupError, probeClaudeVersion, withClaudeVersion,
  VERSION_PROBE_MAX_BYTES, VERSION_PROBE_TIMEOUT_MS,
} from '../src/claude.js';

const execute = promisify(execFile);
const reviewArgs = ['--print', '--output-format', 'json', '--no-session-persistence',
  '--dangerously-skip-permissions', '/code-review medium'];

async function fakeClaude(mode: string, versionOutput = '') {
  const cwd = await mkdtemp(join(tmpdir(), 'pi-review-probe-test-'));
  const executable = join(cwd, 'claude');
  const record = join(cwd, 'calls.jsonl');
  await writeFile(executable, `#!${process.execPath}\n` + `
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(record)}, JSON.stringify(args) + '\\n');
if (args[0] === '--version') {
  const mode = ${JSON.stringify(mode)};
  if (mode === 'hang') setInterval(() => {}, 1000);
  else if (mode === 'overflow') process.stdout.write('x'.repeat(100000));
  else {
    process.stdout.write(${JSON.stringify(versionOutput)});
    process.exitCode = mode === 'fail' ? 1 : 0;
  }
} else {
  process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: 'No findings.' }));
}
`, { mode: 0o700 });
  return { cwd, executable, record, deadline: Date.now() + 10000 };
}

const versions = [
  { mode: 'ok', raw: '2.1.281 (Claude Code)\n', status: 'reported', version: '2.1.281' },
  { mode: 'ok', raw: '2.1.296 (Claude Code)\n', status: 'reported', version: '2.1.296' },
  { mode: 'ok', raw: '99.7.3 (Claude Code)\n', status: 'reported', version: '99.7.3' },
  { mode: 'ok', raw: 'preview build unknown\n', status: 'unrecognized', version: null },
  { mode: 'ok', raw: 'not a version 2..1\n', status: 'unrecognized', version: null },
  { mode: 'ok', raw: '', status: 'unavailable', version: null },
  { mode: 'fail', raw: 'Version service unavailable\n', status: 'unavailable', version: null },
  { mode: 'hang', raw: '', status: 'unavailable', version: null },
  { mode: 'overflow', raw: '', status: 'unavailable', version: null },
];

for (const scenario of versions) {
  test(`diagnostic ${scenario.mode}/${scenario.raw.trim() || 'empty'} never gates review`, {
    skip: process.platform === 'win32' ? 'POSIX executable fixture' : false,
  }, async () => {
    const environment = await fakeClaude(scenario.mode, scenario.raw);
    try {
      const result = await withClaudeVersion(environment, async (version) => {
        assert.equal(version.status, scenario.status);
        assert.equal(version.version, scenario.version);
        assert.ok(Buffer.byteLength(version.raw) <= VERSION_PROBE_MAX_BYTES + 3);
        if (!['hang', 'overflow'].includes(scenario.mode)) assert.equal(version.raw, scenario.raw.trim());
        const review = await execute(environment.executable, reviewArgs, { cwd: environment.cwd, shell: false });
        return JSON.parse(review.stdout);
      });
      assert.equal(result.result, 'No findings.');
      const calls = (await readFile(environment.record, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      assert.deepEqual(calls, [['--version'], reviewArgs]);
    } finally {
      await rm(environment.cwd, { recursive: true, force: true });
    }
  });
}

test('missing executable fails clearly without review, installation or fallback', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'pi-review-missing-'));
  let reviewed = false;
  try {
    await assert.rejects(withClaudeVersion({ cwd, executable: join(cwd, 'absent'), deadline: Date.now() + 5000 }, async () => {
      reviewed = true;
    }), (error: unknown) => error instanceof ClaudeSetupError && /not found.*manually/.test(error.message));
    assert.equal(reviewed, false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('probe respects the shared total deadline', { skip: process.platform === 'win32' }, async () => {
  const environment = await fakeClaude('hang');
  let reviewed = false;
  const started = Date.now();
  try {
    await assert.rejects(withClaudeVersion({ ...environment, deadline: Date.now() + 100 }, async () => {
      reviewed = true;
    }), /deadline expired/);
    assert.equal(reviewed, false);
    assert.ok(Date.now() - started < VERSION_PROBE_TIMEOUT_MS);
  } finally {
    await rm(environment.cwd, { recursive: true, force: true });
  }
});

test('abort prevents review before and during preflight', { skip: process.platform === 'win32' }, async () => {
  const environment = await fakeClaude('hang');
  const controller = new AbortController();
  let reviewed = false;
  const timer = setTimeout(() => controller.abort(), 100);
  try {
    await assert.rejects(withClaudeVersion({ ...environment, signal: controller.signal }, async () => {
      reviewed = true;
    }), /abort/i);
    assert.equal(reviewed, false);
    await assert.rejects(probeClaudeVersion({ ...environment, signal: controller.signal }), /abort/i);
  } finally {
    clearTimeout(timer);
    await rm(environment.cwd, { recursive: true, force: true });
  }
});

test('attributed interface fixture is sourced from the repository, not conversation state', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/builtin-reference.json', import.meta.url), 'utf8'));
  const design = await readFile(new URL('../openspec/changes/add-claude-code-review-wrapper/design.md', import.meta.url), 'utf8');
  assert.equal(fixture.referenceVersion, '2.1.296');
  assert.match(fixture.attribution, /Maintainer report.*not independently verified/);
  assert.ok(design.includes(fixture.argumentHint));
  for (const effort of fixture.localEfforts) assert.ok(design.includes('`' + effort + '`'));
  assert.match(fixture.versionPolicy, /no version allowlist/);
});
