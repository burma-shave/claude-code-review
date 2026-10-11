import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import test from 'node:test';
import { openRunLogs } from '../src/logs.js';
import { runReview } from '../src/runner.js';
import type { RunResult } from '../src/runner.js';

async function withFake(body: string, action: (cwd: string, executable: string, results: RunResult[]) => Promise<void>) {
  const cwd = await mkdtemp(join(tmpdir(), 'review-logs-test-'));
  const executable = join(cwd, 'claude.cjs');
  const results: RunResult[] = [];
  await writeFile(executable, `#!${process.execPath}\nif(process.argv.includes('--version')) {console.log('unknown');process.exit(0);}\nconst fs=require('node:fs');\nprocess.stdin.resume();process.stdin.on('end',()=>{${body}});`, { mode: 0o700 });
  try { await action(cwd, executable, results); }
  finally {
    for (const result of results) if (result.logs) await rm(result.logs.directory, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
}

const done = `console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,result:'review report'}));`;

test('concurrent runs retain separate restricted logs outside the checkout', async () => {
  await withFake(`console.error('sensitive context from upstream');${done}`, async (cwd, executable, results) => {
    results.push(...await Promise.all(Array.from({ length: 4 }, () => runReview({ context: 'private note' }, { cwd, executable }))));
    assert.equal(new Set(results.map(result => result.logs?.directory)).size, 4);
    for (const result of results) {
      assert.equal(result.status, 'completed');
      const logs = result.logs!;
      assert.ok(!logs.directory.startsWith(`${cwd}/`));
      assert.match(logs.directory, /pi-claude-code-review-/);
      assert.equal(await readFile(logs.stderr, 'utf8'), 'sensitive context from upstream\n');
      assert.match(await readFile(logs.stdout, 'utf8'), /review report/);
      if (process.platform !== 'win32') {
        assert.equal((await stat(logs.directory)).mode & 0o077, 0);
        assert.equal((await stat(logs.stdout)).mode & 0o077, 0);
        assert.equal((await stat(logs.stderr)).mode & 0o077, 0);
      }
    }
    assert.deepEqual(await readdir(cwd), ['claude.cjs']);
  });
});

test('large output is completely streamed to disk, not returned or retained as an event stream', async () => {
  const count = 8 * 1024 * 1024;
  await withFake(`process.stdout.write(JSON.stringify({type:'assistant',text:'x'.repeat(${count})})+'\\n');process.stderr.write('y'.repeat(${count}));${done}`, async (cwd, executable, results) => {
    const result = await runReview({}, { cwd, executable }); results.push(result);
    assert.equal(result.status, 'completed');
    assert.equal(result.text, 'review report');
    assert.equal(result.diagnostic, null);
    const stdout = await readFile(result.logs!.stdout);
    assert.ok(stdout.length > count);
    assert.equal(JSON.parse(stdout.toString().split('\n')[0]!).text.length, count);
    assert.equal((await stat(result.logs!.stderr)).size, count);
  });
});

test('failed log writes terminate a running owned child, close streams, and do not retry', async () => {
  await withFake(`fs.writeFileSync('pid',String(process.pid));process.stdout.write('partial output\\n');setInterval(()=>{},1000);`, async (cwd, executable, results) => {
    let calls = 0;
    const streams: Writable[] = [];
    const result = await runReview({ timeoutSeconds: 5 }, { cwd, executable, openLogs: async () => {
      calls++;
      const stdout = new Writable({ write(_chunk, _encoding, callback) { callback(new Error('injected ENOSPC')); } });
      const stderr = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
      streams.push(stdout, stderr);
      return { stdout, stderr };
    } }); results.push(result);
    assert.equal(result.status, 'failed');
    assert.match(result.diagnostic!, /Log write failed: injected ENOSPC/);
    assert.ok(result.durationMs < 5000);
    assert.equal(calls, 1);
    assert.ok(streams.every(stream => stream.destroyed || stream.writableFinished));
    const pid = Number(await readFile(join(cwd, 'pid'), 'utf8'));
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  });
});

test('log setup failures occur before review launch', async () => {
  await withFake(`fs.writeFileSync('review-started','yes');${done}`, async (cwd, executable, results) => {
    const result = await runReview({}, { cwd, executable, openLogs: async () => { throw new Error('injected EACCES'); } }); results.push(result);
    assert.equal(result.status, 'failed');
    assert.match(result.diagnostic!, /Log setup failed: injected EACCES/);
    assert.deepEqual(await readdir(cwd), ['claude.cjs']);
  });
});

test('exclusive log creation refuses existing files and closes the first handle on second-file failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'review-log-open-'));
  const logs = { directory, stdout: join(directory, 'stdout'), stderr: join(directory, 'stderr') };
  await writeFile(logs.stderr, 'existing');
  try {
    await assert.rejects(openRunLogs(logs), { code: 'EEXIST' });
    assert.equal(await readFile(logs.stderr, 'utf8'), 'existing');
    await assert.rejects(openRunLogs(logs), { code: 'EEXIST' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
