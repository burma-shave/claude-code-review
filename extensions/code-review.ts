import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { ReviewExecutor } from '../src/executor.js';
import { ResultSchema, toolResult } from '../src/results.js';
import { ReviewInputSchema } from '../src/schema.js';

export function registerShutdown(pi: ExtensionAPI, executor: ReviewExecutor): void {
  pi.on('session_shutdown', () => executor.shutdown());
}

/** Thin adapter: no startup subprocesses, settings mutations, or interactive UI. */
export function registerReviewTool(pi: ExtensionAPI, executor: Pick<ReviewExecutor, 'execute'>): void {
  pi.registerTool({
    name: 'claude_code_review',
    label: 'Claude Code review',
    description: 'Run the installed Claude built-in /code-review in a fresh process. Defaults to medium effort and bypasses Claude permission checks (--dangerously-skip-permissions); use a trusted or isolated environment. Fixes and comments require explicit authorization and default off, but do not enforce read-only access. Context is separate guidance. Ultra/cloud posting is manual-only. Output is bounded to 2000 lines/50 KiB with full local logs. Do not automatically retry side effects or change permission policy after failure.',
    parameters: ReviewInputSchema,
    outputSchema: ResultSchema,
    async execute(_id, params, signal, _onUpdate, ctx) {
      return toolResult(await executor.execute(params, {
        cwd: ctx.cwd, ...(signal ? { signal } : {}),
      }));
    },
  });
}

export default function codeReviewExtension(pi: ExtensionAPI): void {
  const executor = new ReviewExecutor();
  registerShutdown(pi, executor);
  registerReviewTool(pi, executor);
}
