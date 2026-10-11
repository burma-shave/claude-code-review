import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Value } from 'typebox/value';
import type { ExtensionAPI, ExtensionToolContext, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { registerReviewTool } from '../extensions/code-review.js';
import { runReview } from '../src/runner.js';
import { ReviewInputSchema } from '../src/schema.js';
import { ResultSchema } from '../src/results.js';

function capture(execute: Parameters<typeof registerReviewTool>[1]['execute']): ToolDefinition {
  let tool: ToolDefinition | undefined;
  registerReviewTool({ registerTool: (definition: ToolDefinition) => { tool = definition; } } as unknown as ExtensionAPI, { execute });
  return tool!;
}

test('adapter propagates cwd/signal without UI and preserves validation errors', async () => {
  const controller = new AbortController();
  controller.abort();
  const tool = capture(async (raw, env) => {
    assert.equal(env.cwd, '/headless');
    assert.equal(env.signal, controller.signal);
    return runReview(raw, env);
  });
  assert.equal(tool.name, 'claude_code_review');
  assert.equal(tool.parameters, ReviewInputSchema);
  assert.equal(tool.outputSchema, ResultSchema);
  const cancelled = await tool.execute('id', {}, controller.signal, undefined, { cwd: '/headless' } as ExtensionToolContext);
  assert.equal(cancelled.isError, true);
  assert.ok(Value.Check(ResultSchema, cancelled.structuredContent));
  const invalidTool = capture(runReview);
  const invalid = await invalidTool.execute('id', { unknown: true }, undefined, undefined, { cwd: '/headless' } as ExtensionToolContext);
  assert.equal(invalid.isError, true);
  assert.match(JSON.stringify(invalid.structuredContent), /Unknown input field/);
  assert.equal(Value.Check(ReviewInputSchema, { unknown: true }), false);
});

test('headless adapter returns successful fake review and matching structured result', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'review-adapter-'));
  const executable = join(cwd, 'claude.cjs');
  let logs: string | undefined;
  try {
    await writeFile(executable, `#!${process.execPath}\nif(process.argv.includes('--version')){console.log('2.1.281');process.exit(0)}\nprocess.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,result:'One finding.'})));`, { mode: 0o700 });
    const tool = capture(async (raw, env) => {
      const run = await runReview(raw, { ...env, executable });
      logs = run.logs?.directory;
      return run;
    });
    const result = await tool.execute('id', { effort: 'high', maxFindings: 'default' }, undefined, undefined, { cwd } as ExtensionToolContext);
    assert.equal(result.isError, false);
    assert.ok(Value.Check(ResultSchema, result.structuredContent));
    assert.match(JSON.stringify(result.content), /One finding/);
    assert.match(JSON.stringify(result.structuredContent), /user-supplied/);
    assert.match(JSON.stringify(result.structuredContent), /2.1.281/);
  } finally {
    if (logs) await rm(logs, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});
