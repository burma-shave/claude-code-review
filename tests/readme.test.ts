import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { prepareCommand } from '../src/invocation.js';
import { serializeReviewMessage } from '../src/transport.js';

const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
const snapshots = [...readme.matchAll(/```json\n([\s\S]*?)\n```\n\nCommand: `([^`]+)`/g)];

test('README has invocation snapshots for every target and local effort', async () => {
  assert.equal(snapshots.length, 7);
  const efforts = new Set<string>();
  const kinds = new Set<string>();
  for (const snapshot of snapshots) {
    const input = JSON.parse(snapshot[1]!);
    const prepared = await prepareCommand(input, { cwd: tmpdir(), deadline: Date.now() + 5000, ghExecutable: '/must/not/run' });
    assert.equal(prepared.command, snapshot[2]);
    const message = JSON.parse(serializeReviewMessage(prepared.input, prepared.target));
    assert.equal(message.message.content.at(-1).text, snapshot[2]);
    if (input.context !== undefined) assert.ok(message.message.content[0].text.endsWith(input.context));
    efforts.add(prepared.input.effort);
    kinds.add(prepared.input.target?.kind ?? 'current-diff');
  }
  assert.deepEqual([...efforts].sort(), ['high', 'low', 'max', 'medium', 'xhigh']);
  assert.deepEqual([...kinds].sort(), ['branch', 'current-diff', 'path', 'pr', 'pr-url']);
});
