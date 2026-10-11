import { executeBounded } from './process.js';

export const VERSION_PROBE_TIMEOUT_MS = 2000;
export const VERSION_PROBE_MAX_BYTES = 4096;

export interface ClaudeEnvironment {
  cwd: string;
  /** Absolute total-run deadline, shared with the eventual review runner. */
  deadline: number;
  signal?: AbortSignal;
  /** Internal dependency injection for tests; not a user tool input. */
  executable?: string;
}

export interface VersionDiagnostic {
  status: 'reported' | 'unrecognized' | 'unavailable';
  version: string | null;
  raw: string;
  diagnostic: string | null;
}

export class ClaudeSetupError extends Error {
  override name = 'ClaudeSetupError';
}

function checkExecutionBudget(environment: ClaudeEnvironment): void {
  environment.signal?.throwIfAborted();
  if (Date.now() >= environment.deadline) {
    throw new Error('Claude execution deadline expired before review.');
  }
}

function boundedText(text: string): string {
  return Buffer.from(text).subarray(0, VERSION_PROBE_MAX_BYTES).toString('utf8').trim();
}

/** Diagnostic only: unfamiliar versions and failed probes are never compatibility gates. */
export async function probeClaudeVersion(environment: ClaudeEnvironment): Promise<VersionDiagnostic> {
  checkExecutionBudget(environment);
  const executable = environment.executable ?? 'claude';
  const timeout = Math.max(1, Math.min(VERSION_PROBE_TIMEOUT_MS, environment.deadline - Date.now()));
  const { error, stdout, stderr } = await executeBounded(executable, ['--version'], {
    cwd: environment.cwd, timeoutMs: timeout, maxBytes: VERSION_PROBE_MAX_BYTES,
    ...(environment.signal ? { signal: environment.signal } : {}),
  });
  checkExecutionBudget(environment);
  const raw = boundedText(stdout || stderr);
  if (error && 'code' in error && error.code === 'ENOENT') {
    throw new ClaudeSetupError('Claude executable not found. Install and authenticate Claude Code manually; no automatic installation or plugin fallback is performed.');
  }
  if (error) return { status: 'unavailable', version: null, raw, diagnostic: boundedText(error.message) };
  const version = /^(\d+\.\d+\.\d+(?:-[\w.-]+)?)(?:\s|$)/.exec(raw)?.[1] ?? null;
  return { status: version ? 'reported' : raw ? 'unrecognized' : 'unavailable', version, raw, diagnostic: null };
}

/** Shared preflight seam: review is attempted regardless of diagnostic version. */
export async function withClaudeVersion<T>(
  environment: ClaudeEnvironment,
  review: (version: VersionDiagnostic) => Promise<T>,
): Promise<T> {
  const version = await probeClaudeVersion(environment);
  checkExecutionBudget(environment);
  return review(version);
}
