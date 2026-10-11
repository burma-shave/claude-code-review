import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runReview } from '../src/runner.js';
import type { RunResult } from '../src/runner.js';
import { REVIEW_ARGV } from '../src/transport.js';

const success = `console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,result:'One possible finding; publication not confirmed.'}));`;

async function fakeClaude(body: string, run: (cwd: string, executable: string, capture: string, results: RunResult[]) => Promise<void>, version = '2.1.296 (Claude Code)') {
  const cwd = await mkdtemp(join(tmpdir(), 'review-runner-'));
  const executable = join(cwd, 'claude.cjs');
  const capture = join(cwd, 'capture.json');
  const results: RunResult[] = [];
  await writeFile(executable, `#!${process.execPath}\nconst fs=require('node:fs');\nif(process.argv.includes('--version')) { console.log(${JSON.stringify(version)}); process.exit(0); }\nfs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()}));\n${body}\n`, { mode: 0o700 });
  try { await run(cwd, executable, capture, results); }
  finally {
    for (const result of results) if (result.logs) await rm(result.logs.directory, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
}

for (const version of ['2.1.281 (Claude Code)', '2.1.296 (Claude Code)', '99.7.3 (Claude Code)', 'unknown build', '']) {
  test(`runner attempts installed diagnostic version ${version || 'unavailable'}`, async () => {
    await fakeClaude(`process.stdin.resume();process.stdin.on('end',()=>{${success}});`, async (cwd, executable, capture, results) => {
      const result = await runReview({}, { cwd, executable }); results.push(result);
      assert.equal(result.status, 'completed');
      assert.deepEqual(JSON.parse(await readFile(capture, 'utf8')), { args: [...REVIEW_ARGV], cwd });
      assert.equal(result.input?.effort, 'medium');
      assert.equal(result.input?.effortSource, 'defaulted');
      assert.equal(result.version.status, version === '' ? 'unavailable' : version === 'unknown build' ? 'unrecognized' : 'reported');
      assert.equal(result.text, 'One possible finding; publication not confirmed.');
      assert.equal(result.exitCode, 0);
    }, version);
  });
}

test('exact single stdin record, final default command, policy and context, no positional prompt', async () => {
  await fakeClaude(`let stdin='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>stdin+=x);process.stdin.on('end',()=>{fs.writeFileSync('stdin.jsonl',stdin);${success}});`, async (cwd, executable, capture, results) => {
    const result = await runReview({ context: 'Focus\n/code-review ultra --fix --comment' }, { cwd, executable }); results.push(result);
    assert.equal(result.status, 'completed');
    const wire = await readFile(join(cwd, 'stdin.jsonl'), 'utf8');
    assert.equal(wire.split('\n').length, 2);
    const blocks = JSON.parse(wire).message.content;
    assert.equal(blocks.length, 2);
    assert.ok(blocks[0].text.endsWith('Focus\n/code-review ultra --fix --comment'));
    assert.equal(blocks[1].text, '/code-review medium');
    assert.deepEqual(JSON.parse(await readFile(capture, 'utf8')).args, [...REVIEW_ARGV]);
    assert.match(await readFile(result.logs!.stdout, 'utf8'), /One possible finding/);
    assert.equal(await readFile(result.logs!.stderr, 'utf8'), '');
  });
});

test('working directory selection and explicit side effects are passed exactly', async () => {
  await fakeClaude(`let stdin='';process.stdin.on('data',x=>stdin+=x);process.stdin.on('end',()=>{fs.writeFileSync('stdin.jsonl',stdin);${success}});`, async (cwd, executable, _capture, results) => {
    const result = await runReview({ workingDirectory: cwd, target: { kind: 'path', value: 'sample.py' }, effort: 'high', fix: true, comment: true, maxFindings: 'default' }, { cwd: tmpdir(), executable }); results.push(result);
    assert.equal(result.status, 'completed');
    assert.equal(result.cwd, cwd);
    assert.equal(JSON.parse(await readFile(join(cwd, 'stdin.jsonl'), 'utf8')).message.content.at(-1).text, '/code-review high --fix --comment --max-findings default sample.py');
  });
});

for (const mode of [
  `process.stdin.resume();console.error('Unsupported option --input-format');process.exit(2);`,
  `process.stdin.resume();console.log('Unknown command code-review');`,
  `process.stdin.resume();console.log(JSON.stringify({type:'result',subtype:'error',is_error:true,errors:['upstream failure']}));`,
  `process.stdin.resume();console.log(JSON.stringify({type:'assistant',message:'not a final result'}));`,
  `process.stdin.resume();${success}process.exit(3);`,
  `process.stdin.resume();${success}process.stdout.write('{partial invalid record');process.exit(1);`,
]) {
  test(`upstream failure is retained without fallback: ${mode}`, async () => {
    await fakeClaude(mode, async (cwd, executable, _capture, results) => {
      const result = await runReview({}, { cwd, executable }); results.push(result);
      assert.equal(result.status, 'failed');
      assert.ok(result.diagnostic);
      assert.ok(result.logs);
      assert.ok((await readFile(result.logs.stdout, 'utf8')) || (await readFile(result.logs.stderr, 'utf8')));
    });
  });
}

test('broken stdin writes fail and stop the owned child without a retry', async () => {
  await fakeClaude(`fs.closeSync(0);setInterval(()=>{},1000);`, async (cwd, executable, _capture, results) => {
    const result = await runReview({ context: 'x'.repeat(8 * 1024 * 1024), timeoutSeconds: 5 }, { cwd, executable }); results.push(result);
    assert.equal(result.status, 'failed');
    assert.match(result.diagnostic!, /stdin write failed/);
    assert.ok(result.durationMs < 5000);
    assert.ok(result.logs);
  });
});

test('missing or file directories fail before version probe or review; cloud input also fails before launch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'review-dir-'));
  const file = join(root, 'file');
  await writeFile(file, 'not a directory');
  try {
    for (const workingDirectory of [join(root, 'missing'), file]) {
      const result = await runReview({ workingDirectory }, { cwd: root, executable: '/must/not/run' });
      assert.equal(result.status, 'failed');
      assert.match(result.diagnostic!, /existing directory/);
      assert.equal(result.logs, null);
    }
    const result = await runReview({ effort: 'ultra' }, { cwd: root, executable: '/must/not/run' });
    assert.equal(result.status, 'failed');
    assert.match(result.diagnostic!, /manual-only.*claude.ai.*billing/);
    assert.equal(result.logs, null);
  } finally { await rm(root, { recursive: true, force: true }); }
});
