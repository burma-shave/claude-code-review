import { executeBounded } from './process.js';
import { InputValidationError, validateRepository } from './inputs.js';
import type { ReviewTarget } from './inputs.js';

export const REPOSITORY_LOOKUP_TIMEOUT_MS = 2000;
export const REPOSITORY_LOOKUP_MAX_BYTES = 4096;

export interface TargetEnvironment {
  cwd: string;
  deadline: number;
  signal?: AbortSignal;
  /** Internal testing seam, never a tool input. */
  ghExecutable?: string;
}

export function checkTargetBudget(environment: TargetEnvironment): void {
  environment.signal?.throwIfAborted();
  if (Date.now() >= environment.deadline) throw new Error('Execution deadline expired during target preparation.');
}

export function canonicalPrUrl(value: string): string {
  // Match the wire form, not URL-normalized arbitrary paths, credentials, or escaped tokens.
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/([1-9][0-9]*)\/?$/.exec(value);
  if (!match || /\s/.test(value)) {
    throw new InputValidationError('Unsupported PR URL. Use https://github.com/owner/repo/pull/123 without query or fragment; GitLab MR URLs are not supported.');
  }
  const repository = validateRepository(`${match[1]}/${match[2]}`);
  const number = Number(match[3]);
  if (!Number.isSafeInteger(number)) throw new InputValidationError('PR URL number must be a positive safe integer.');
  return `https://github.com/${repository}/pull/${number}`;
}

/** A bounded read-only gh request; explicit repository and URL targets never call it. */
export async function lookupRepository(environment: TargetEnvironment): Promise<string> {
  checkTargetBudget(environment);
  const timeout = Math.max(1, Math.min(REPOSITORY_LOOKUP_TIMEOUT_MS, environment.deadline - Date.now()));
  const { error, stdout: output, stderr } = await executeBounded(environment.ghExecutable ?? 'gh', ['repo', 'view', '--json', 'nameWithOwner'], {
    cwd: environment.cwd, timeoutMs: timeout, maxBytes: REPOSITORY_LOOKUP_MAX_BYTES,
    ...(environment.signal ? { signal: environment.signal } : {}),
  });
  if (error) {
    throw new InputValidationError(`Repository context is required for a numeric PR. Supply target.repository as owner/repo, or install/authenticate gh in the selected directory. Lookup failed: ${stderr.trim().slice(0, 1000) || error.message.slice(0, 1000)}`);
  }
  checkTargetBudget(environment);
  try {
    const parsed: unknown = JSON.parse(output);
    if (parsed === null || typeof parsed !== 'object' || !('nameWithOwner' in parsed)) throw new Error('Missing nameWithOwner');
    return validateRepository(parsed.nameWithOwner);
  } catch {
    throw new InputValidationError('Repository lookup returned invalid nameWithOwner. Supply target.repository as owner/repo.');
  }
}

export async function resolveTarget(target: ReviewTarget | undefined, environment: TargetEnvironment): Promise<string | undefined> {
  checkTargetBudget(environment);
  if (!target) return undefined;
  switch (target.kind) {
    case 'pr': {
      const repository = target.repository ?? await lookupRepository(environment);
      return canonicalPrUrl(`https://github.com/${repository}/pull/${target.number}`);
    }
    case 'pr-url': return canonicalPrUrl(target.url);
    case 'path':
    case 'branch': return target.value;
  }
}
