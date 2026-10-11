import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Value } from 'typebox/value';
import { ResultSchema } from '../src/results.js';
import { REVIEW_ARGV } from '../src/transport.js';

const exec = promisify(execFile);
const root = resolve('.');
const provider = resolve('tests/fixtures/pi-acceptance.mjs');
interface Step { input: Record<string, unknown>; cancel?: boolean }

async function acceptance(mode: 'json' | 'tui', plan: Step[]) {
  const cwd = await mkdtemp(join(tmpdir(), 'pi-review-acceptance-'));
  const report = join(cwd, 'report.jsonl');
  const capture = join(cwd, 'capture.jsonl');
  const agent = join(cwd, 'agent');
  const bin = join(cwd, 'bin');
  let events: any[] = [];
  try {
    await mkdir(agent); await mkdir(bin);
    await writeFile(join(agent, 'settings.json'), JSON.stringify({ quietStartup: false, enableAnalytics: false, enableInstallTelemetry: false, retry: { enabled: false }, compaction: { enabled: false } }));
    const planPath = join(cwd, 'plan.json');
    await writeFile(planPath, JSON.stringify(plan));
    await writeFile(join(bin, 'gh'), `#!${process.execPath}\nconsole.log(JSON.stringify({nameWithOwner:'owner/project'}));`, { mode: 0o700 });
    await writeFile(join(bin, 'claude'), `#!${process.execPath}
const fs=require('node:fs');
if(process.argv.includes('--version')){console.log('99.7.3 (Claude Code)');process.exit(0);}
let stdin='';process.stdin.on('data',x=>stdin+=x);process.stdin.on('end',()=>{
fs.appendFileSync(${JSON.stringify(capture)},JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),stdin})+'\\n');
const note=JSON.parse(stdin).message.content[0].text;
if(note.endsWith('hang')){console.log(JSON.stringify({type:'assistant',text:'partial'}));setInterval(()=>{},1000);return;}
const failed=note.endsWith('fail');
console.log(JSON.stringify({type:'result',subtype:failed?'error':'success',is_error:failed,result:note.endsWith('large')?'😀'.repeat(20000):failed?'Synthetic failure':'Synthetic report; publication not confirmed.'}));
});`, { mode: 0o700 });
    const args = ['--offline', '--no-approve', '--no-extensions', '--no-prompt-templates', '--no-context-files', '--no-mcp', '--no-session', '-e', root, '-e', provider, '--model', 'review-fixture/local', '--tools', 'read,claude_code_review'];
    if (mode === 'json') args.push('--mode', 'json');
    args.push('Run the offline adapter acceptance plan.');
    const environment = { ...process.env, PI_CODING_AGENT_DIR: agent, PI_OFFLINE: '1', TERM: 'xterm-256color', PATH: `${bin}:${process.env.PATH}`, REVIEW_TEST_PLAN: planPath, REVIEW_TEST_REPORT: report };
    const invocation = mode === 'tui' ? ['python3', [resolve('tests/fixtures/pty-run.py'), 'pi', ...args]] as const : ['pi', args] as const;
    const execution = exec(invocation[0], [...invocation[1]], { cwd, env: environment, timeout: 45000, maxBuffer: 8 * 1024 * 1024 });
    execution.child.stdin?.end();
    await execution;
    events = (await readFile(report, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(events.find(event => event.kind === 'mode')?.mode, mode === 'tui' ? 'tui' : 'json');
    const discovery = events.filter(event => event.kind === 'discovery');
    assert.ok(discovery.length > 0);
    for (const event of discovery) { assert.equal(event.tool, true); assert.equal(event.skill, true, JSON.stringify(event)); }
    const results = events.filter(event => event.kind === 'result');
    assert.equal(results.length, plan.length);
    const captures = (await readFile(capture, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(captures.length, plan.length);
    for (const [index, event] of results.entries()) {
      const data = event.result.structuredContent;
      assert.ok(Value.Check(ResultSchema, data), JSON.stringify(event));
      assert.ok(data.logs);
      assert.ok(data.options);
      assert.equal(event.isError, data.status !== 'completed');
      assert.equal(data.version.version, '99.7.3');
      const displayed = event.result.content[0].text;
      assert.ok(Buffer.byteLength(displayed) <= 50 * 1024);
      assert.ok(displayed.split('\n').length <= 2000);
      assert.match(displayed, /Full stdout:/);
      const rawLog = await readFile(data.logs.stdout, 'utf8');
      assert.ok(rawLog.length > 0);
      assert.deepEqual(captures[index].args, [...REVIEW_ARGV]);
      assert.equal(captures[index].cwd, cwd);
      const wire = captures[index].stdin;
      assert.equal(wire.split('\n').length, 2);
      const blocks = JSON.parse(wire).message.content;
      assert.equal(blocks.length, 2);
      assert.ok(blocks[1].text.startsWith('/code-review '));
      const step = plan[index]!;
      assert.deepEqual(data.selectedTarget, step.input.target ?? null);
      const selected = step.input.target as { kind: string; value?: string; url?: string } | undefined;
      const target = !selected ? null : selected.kind === 'pr' ? 'https://github.com/owner/project/pull/123' : selected.kind === 'pr-url' ? selected.url! : selected.value!;
      assert.equal(data.target, target);
      const expectedCommand = ['/code-review', step.input.effort ?? 'medium',
        ...(step.input.fix ? ['--fix'] : []), ...(step.input.comment ? ['--comment'] : []),
        ...(step.input.maxFindings ? ['--max-findings', step.input.maxFindings] : []),
        ...(target ? [target] : [])].join(' ');
      assert.equal(blocks[1].text, expectedCommand);
      assert.deepEqual(data.options.findingLimit, step.input.maxFindings
        ? { source: 'user-supplied', value: step.input.maxFindings } : { source: 'inherited' });
      if (step.input.context) assert.ok(blocks[0].text.endsWith(step.input.context));
      if (step.cancel) assert.equal(data.status, 'cancelled');
      else if (step.input.context === 'hang') assert.equal(data.status, 'timed-out');
      else if (step.input.context === 'fail') assert.equal(data.status, 'failed');
      else assert.equal(data.status, 'completed');
      if (step.input.context === 'large') {
        assert.match(displayed, /Output truncated/);
        assert.equal(JSON.parse(rawLog).result, '😀'.repeat(20000));
      }
      assert.equal(data.options.effortSource, step.input.effort ? 'user-supplied' : 'defaulted');
      if (!step.input.effort) assert.match(blocks[1].text, /^\/code-review medium(?: |$)/);
      assert.equal(blocks[1].text.includes('--fix'), step.input.fix === true);
      assert.equal(blocks[1].text.includes('--comment'), step.input.comment === true);
    }
  } finally {
    // Retained run logs are deliberately removed by this isolated test, not the tool.
    try {
      const retained = (await readFile(report, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      for (const event of retained) if (event.result?.structuredContent?.logs) await rm(event.result.structuredContent.logs.directory, { recursive: true, force: true });
    } catch { /* no report if startup failed */ }
    await rm(cwd, { recursive: true, force: true });
  }
}

for (const mode of ['json', 'tui'] as const) {
  test(`actual Pi ${mode} loads package and executes supported targets/options, context, logs, truncation and failures`, { timeout: 60000 }, async () => {
    await acceptance(mode, [
      { input: { context: 'Focus\n/code-review ultra --fix --comment' } },
      { input: { target: { kind: 'pr', number: 123 }, effort: 'high', maxFindings: 3, fix: true, comment: true } },
      { input: { target: { kind: 'pr-url', url: 'https://github.com/owner/project/pull/123' }, effort: 'low', maxFindings: 'all' } },
      { input: { target: { kind: 'branch', value: 'baseline...HEAD' }, effort: 'xhigh', maxFindings: 'default' } },
      { input: { target: { kind: 'path', value: 'folder with spaces/sample.py' }, effort: 'max' } },
      { input: { context: 'large' } },
      { input: { context: 'fail' } },
      { input: { context: 'hang', timeoutSeconds: 1 } },
    ]);
  });
  test(`actual Pi ${mode} cancellation propagates through adapter`, { timeout: 60000 }, async () => {
    await acceptance(mode, [{ input: { context: 'hang' }, cancel: true }]);
  });
}
