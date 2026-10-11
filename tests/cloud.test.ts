import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { normalizeInput } from '../src/inputs.js';
import { buildCommand, prepareCommand } from '../src/invocation.js';
import { serializeReviewMessage } from '../src/transport.js';

for (const effort of ['ultra', undefined, 'low', 'medium', 'high', 'xhigh', 'max']) {
  for (const cloudPost of [undefined, 'post', 'no-post']) {
    if (effort !== 'ultra' && cloudPost === undefined) continue;
    test(`no child launches for effort=${effort}, cloudPost=${cloudPost}`, async () => {
      const cwd = await mkdtemp(join(tmpdir(), 'review-cloud-'));
      const marker = join(cwd, 'child-started');
      const fake = join(cwd, 'child.cjs');
      await writeFile(fake, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started');\n`, { mode: 0o700 });
      try {
        const raw = { effort, cloudPost, target: { kind: 'pr', number: 123 } };
        await assert.rejects(prepareCommand(raw, { cwd, deadline: Date.now() + 5000, ghExecutable: fake })
          .then(() => { spawnSync(fake, [], { cwd, shell: false }); }), error => {
            assert.ok(error instanceof Error);
            assert.match(error.message, /manual|Manual/);
            assert.match(error.message, /\/code-review ultra/);
            assert.match(error.message, /claude.ai/);
            assert.match(error.message, /billing/);
            if (effort === 'ultra') {
              assert.match(error.message, /no local effort was substituted/);
              if (cloudPost) assert.match(error.message, new RegExp(`--${cloudPost}`));
            } else assert.match(error.message, /incompatible/);
            return true;
          });
        await assert.rejects(access(marker), { code: 'ENOENT' });
      } finally { await rm(cwd, { recursive: true, force: true }); }
    });
  }
}

test('direct command and transport construction also reject manual-only ultra', () => {
  const input = normalizeInput({ effort: 'ultra' });
  assert.equal(input.effort, 'ultra');
  assert.throws(() => buildCommand(input), /manual-only/);
  assert.throws(() => serializeReviewMessage(input), /manual-only/);
});
