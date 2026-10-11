import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { displayResult, DISPLAY_MAX_BYTES, DISPLAY_MAX_LINES } from '../src/results.js';
import { runReview } from '../src/runner.js';
import type { RunResult } from '../src/runner.js';

function check(text: string) {
  assert.ok(Buffer.byteLength(text) <= DISPLAY_MAX_BYTES);
  assert.ok(text.split('\n').length <= DISPLAY_MAX_LINES);
  assert.ok(!text.includes('\ufffd'));
  assert.match(text, /Review status:/);
}
function run(text: string): RunResult {
  return { status: 'completed', input: null, target: null, cwd: '/', version: { status: 'unavailable', version: null, raw: '', diagnostic: null }, durationMs: 0, exitCode: 0, exitSignal: null, logs: { directory: '/logs', stdout: '/logs/stdout.jsonl', stderr: '/logs/stderr.log' }, text, diagnostic: null };
}
for (const text of ['small', '😀'.repeat(20000), 'line\n'.repeat(2000), 'x'.repeat(51200), '漢字\n'.repeat(10000)]) {
  test(`display bounds for ${Buffer.byteLength(text)} bytes`, () => {
    const displayed = displayResult(run(text));
    check(displayed);
    assert.match(displayed, /Full stdout: \/logs\/stdout.jsonl/);
    if (text.length > 100) assert.match(displayed, /Output truncated/);
    else assert.ok(!displayed.includes('truncated'));
  });
}
test('byte boundary and complete logs survive display truncation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'review-display-'));
  const executable = join(root, 'claude.cjs');
  const report = '😀'.repeat(20000);
  let result: RunResult | undefined;
  try {
    await writeFile(executable, `#!${process.execPath}\nif(process.argv.includes('--version')){console.log('future');process.exit(0)}\nprocess.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,result:${JSON.stringify(report)}})));`, { mode: 0o700 });
    result = await runReview({}, { cwd: root, executable });
    assert.equal(result.status, 'completed');
    const displayed = displayResult(result);
    check(displayed);
    assert.match(displayed, /Output truncated/);
    assert.equal(JSON.parse(await readFile(result.logs!.stdout, 'utf8')).result, report);
    const overhead = Buffer.byteLength(displayResult(run('')))- 'No readable review output.'.length;
    check(displayResult(run('x'.repeat(DISPLAY_MAX_BYTES - overhead))));
  } finally {
    if (result?.logs) await rm(result.logs.directory, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});
