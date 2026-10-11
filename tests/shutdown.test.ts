import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import codeReviewExtension, { registerShutdown } from '../extensions/code-review.js';
import { ReviewExecutor } from '../src/executor.js';
import { openRunLogs } from '../src/logs.js';
import type { RunResult } from '../src/runner.js';

async function fixture(body: string, action: (cwd: string, executable: string, results: RunResult[]) => Promise<void>) {
  const cwd = await mkdtemp(join(tmpdir(), 'review-shutdown-'));
  const executable = join(cwd, 'claude.cjs');
  const results: RunResult[] = [];
  await writeFile(executable, `#!${process.execPath}\nconst fs=require('node:fs');if(process.argv.includes('--version')) {console.log('2.1.296');process.exit(0);}fs.writeFileSync('started','yes');process.stdin.resume();process.stdin.on('end',()=>{${body}});`, { mode: 0o700 });
  try { await action(cwd, executable, results); }
  finally {
    for (const result of results) if (result.logs) await rm(result.logs.directory, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
}

const success = `console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,result:'done'}));`;

test('extension registration installs only a shutdown handler with no startup work or UI', () => {
  const registrations: string[] = [];
  codeReviewExtension({ on: (event: string) => { registrations.push(event); } } as unknown as ExtensionAPI);
  assert.deepEqual(registrations, ['session_shutdown']);
});

test('shutdown handler cancels and awaits active runs, repeated cleanup shares a promise', async () => {
  await fixture('setInterval(()=>{},1000);', async (cwd, executable, results) => {
    const executor = new ReviewExecutor();
    let handler: (() => Promise<void>) | undefined;
    registerShutdown({ on: (_event: string, callback: () => Promise<void>) => { handler = callback; } } as unknown as ExtensionAPI, executor);
    const running = executor.execute({}, { cwd, executable });
    assert.equal(executor.activeRuns, 1);
    for (let attempts = 0; attempts < 300; attempts++) {
      try { await readFile(join(cwd, 'started')); break; } catch { await delay(10); }
    }
    const shutdown = handler!();
    assert.equal(handler!(), shutdown);
    await shutdown;
    const result = await running; results.push(result);
    assert.equal(result.status, 'cancelled');
    assert.equal(executor.activeRuns, 0);
    await handler!();
  });
});

test('abort during log preparation prevents review spawn and closes created streams', async () => {
  await fixture(success, async (cwd, executable, results) => {
    const executor = new ReviewExecutor();
    const controller = new AbortController();
    const result = await executor.execute({}, { cwd, executable, signal: controller.signal, openLogs: async logs => {
      const streams = await openRunLogs(logs);
      controller.abort();
      return streams;
    } }); results.push(result);
    assert.equal(result.status, 'cancelled');
    await assert.rejects(readFile(join(cwd, 'started')), { code: 'ENOENT' });
    assert.equal(executor.activeRuns, 0);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  });
});

test('abort at exit during log finalization leaves no listeners or active ownership', async () => {
  await fixture(success, async (cwd, executable, results) => {
    const executor = new ReviewExecutor();
    const controller = new AbortController();
    const result = await executor.execute({}, { cwd, executable, signal: controller.signal, openLogs: async logs => {
      const streams = await openRunLogs(logs);
      streams.stdout.once('finish', () => controller.abort());
      return streams;
    } }); results.push(result);
    assert.equal(result.status, 'cancelled');
    assert.equal(result.text, 'done');
    assert.equal(executor.activeRuns, 0);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    await executor.shutdown();
  });
});

test('shutdown during timeout cleanup preserves the first termination cause', async () => {
  await fixture(`process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`, async (cwd, executable, results) => {
    const executor = new ReviewExecutor();
    const running = executor.execute({ timeoutSeconds: 1 }, { cwd, executable });
    const timer = setTimeout(() => { void executor.shutdown(); }, 1020);
    try {
      const result = await running; results.push(result);
      assert.equal(result.status, 'timed-out');
      await executor.shutdown();
      assert.equal(executor.activeRuns, 0);
    } finally { clearTimeout(timer); }
  });
});

test('cancellation before the deadline wins even when cleanup overlaps timeout, and a new session can run', async () => {
  await fixture(`process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`, async (cwd, executable, results) => {
    const executor = new ReviewExecutor();
    const controller = new AbortController();
    const running = executor.execute({ timeoutSeconds: 1 }, { cwd, executable, signal: controller.signal });
    const timer = setTimeout(() => controller.abort(), 970);
    try {
      const result = await running; results.push(result);
      assert.equal(result.status, 'cancelled');
      assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
      await executor.shutdown();
      await writeFile(executable, `#!${process.execPath}\nif(process.argv.includes('--version')){console.log('2.1.296');process.exit(0);}process.stdin.resume();process.stdin.on('end',()=>{${success}});`, { mode: 0o700 });
      const next = await executor.execute({}, { cwd, executable }); results.push(next);
      assert.equal(next.status, 'completed');
      assert.equal(executor.activeRuns, 0);
    } finally { clearTimeout(timer); }
  });
});
