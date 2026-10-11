import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { runReview } from '../src/runner.js';
import type { RunResult } from '../src/runner.js';

async function waitForPids(file: string): Promise<{ parent: number; descendant: number }> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try { return JSON.parse(await readFile(file, 'utf8')); }
    catch { await delay(10); }
  }
  throw new Error('Fake process did not publish its pids.');
}

async function notRunning(pid: number): Promise<boolean> {
  try { process.kill(pid, 0); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true; throw error; }
  if (process.platform === 'linux') {
    try { return (await readFile(`/proc/${pid}/stat`, 'utf8')).split(') ')[1]?.startsWith('Z') ?? false; }
    catch (error) {
      if (['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) return true;
      throw error;
    }
  }
  return false;
}

for (const phase of ['version', 'lookup', 'review']) for (const cause of ['timeout', 'abort']) {
  test(`${cause} terminates owned children and descendants during ${phase}`, { skip: process.platform === 'win32' ? 'POSIX process-group evidence; Windows requires separate acceptance' : false }, async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'review-lifecycle-'));
    const executable = join(cwd, 'cli.cjs');
    const marker = join(cwd, 'pids.json');
    const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
    const unrelatedClosed = new Promise<void>(done => unrelated.once('close', () => done()));
    const controller = new AbortController();
    let result: RunResult | undefined;
    let pids: { parent: number; descendant: number } | undefined;
    await writeFile(executable, `#!${process.execPath}\nconst fs=require('node:fs');const {spawn}=require('node:child_process');
const phase=process.argv.includes('--version')?'version':process.argv.includes('repo')?'lookup':'review';
if(phase!==${JSON.stringify(phase)}) { if(phase==='version') console.log('2.1.296'); else console.log(JSON.stringify({nameWithOwner:'owner/repo'})); process.exit(0); }
const descendant=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'inherit'});
process.stdin.resume();process.on('SIGTERM',()=>{});setInterval(()=>{},1000);
// Readiness must follow completed writes, not merely process creation.
process.stdout.write('partial-output\\n',()=>{
  process.stderr.write('partial-error\\n',()=>{
    fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({parent:process.pid,descendant:descendant.pid}));
  });
});
`, { mode: 0o700 });
    try {
      const running = runReview({ timeoutSeconds: cause === 'timeout' ? 1 : 5,
        ...(phase === 'lookup' ? { target: { kind: 'pr', number: 123 } } : {}),
      }, { cwd, executable, ghExecutable: executable, signal: controller.signal });
      pids = await waitForPids(marker);
      if (cause === 'abort') controller.abort();
      result = await running;
      assert.equal(result.status, cause === 'timeout' ? 'timed-out' : 'cancelled');
      assert.ok(result.durationMs < 3000);
      assert.ok(await notRunning(pids.parent), 'owned parent is stopped');
      assert.ok(await notRunning(pids.descendant), 'owned descendant is stopped');
      assert.equal(await notRunning(unrelated.pid!), false, 'unrelated process remains running');
      if (phase === 'review') {
        assert.equal(await readFile(result.logs!.stdout, 'utf8'), 'partial-output\n');
        assert.equal(await readFile(result.logs!.stderr, 'utf8'), 'partial-error\n');
      } else assert.equal(result.logs, null);
    } finally {
      controller.abort();
      unrelated.kill('SIGKILL');
      await unrelatedClosed;
      if (pids) { try { process.kill(-pids.parent, 'SIGKILL'); } catch { /* already gone */ } }
      if (result?.logs) await rm(result.logs.directory, { recursive: true, force: true });
      await rm(cwd, { recursive: true, force: true });
    }
  });
}

test('abort before execution starts creates no review logs or child', async () => {
  const result = await runReview({}, { cwd: tmpdir(), executable: '/must/not/run', signal: AbortSignal.abort() });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.logs, null);
});
