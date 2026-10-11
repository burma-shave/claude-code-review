import { runReview } from './runner.js';
import type { RunEnvironment, RunResult } from './runner.js';

/** Session-scoped ownership, with no startup timers/processes and awaitable cleanup. */
export class ReviewExecutor {
  private readonly active = new Map<AbortController, Promise<RunResult>>();
  private closing: Promise<void> | undefined;

  get activeRuns(): number { return this.active.size; }

  execute(raw: unknown, environment: RunEnvironment): Promise<RunResult> {
    if (this.closing) return runReview(raw, { ...environment, signal: AbortSignal.abort() });
    const owner = new AbortController();
    const signal = environment.signal ? AbortSignal.any([owner.signal, environment.signal]) : owner.signal;
    const result = runReview(raw, { ...environment, signal }).finally(() => { this.active.delete(owner); });
    this.active.set(owner, result);
    return result;
  }

  /** Repeated shutdown overlaps share one promise. A later session may reuse this executor. */
  shutdown(): Promise<void> {
    if (this.closing) return this.closing;
    for (const owner of this.active.keys()) owner.abort();
    this.closing = Promise.all([...this.active.values()]).then(() => undefined).finally(() => { this.closing = undefined; });
    return this.closing;
  }
}
