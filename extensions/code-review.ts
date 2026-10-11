import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { ReviewExecutor } from '../src/executor.js';

export function registerShutdown(pi: ExtensionAPI, executor: ReviewExecutor): void {
  pi.on('session_shutdown', () => executor.shutdown());
}

/** Lifecycle adapter; tool registration is delivered by the result-integration task. */
export default function codeReviewExtension(pi: ExtensionAPI): void {
  registerShutdown(pi, new ReviewExecutor());
}
