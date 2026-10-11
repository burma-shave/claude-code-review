export const LOCAL_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type LocalEffort = typeof LOCAL_EFFORTS[number];
export type Effort = LocalEffort | 'ultra';
export type MaxFindings = number | 'all' | 'default';
export type ReviewTarget =
  | { kind: 'pr'; number: number; repository?: string }
  | { kind: 'pr-url'; url: string }
  | { kind: 'branch'; value: string }
  | { kind: 'path'; value: string };

export interface ReviewInput {
  target?: ReviewTarget;
  effort?: Effort;
  fix?: boolean;
  comment?: boolean;
  maxFindings?: MaxFindings;
  context?: string;
  workingDirectory?: string;
  timeoutSeconds?: number;
  /** Recognized for manual-only guidance; never forwarded to a local review. */
  cloudPost?: 'post' | 'no-post';
}

export interface NormalizedInput {
  target?: ReviewTarget;
  effort: Effort;
  effortSource: 'defaulted' | 'user-supplied';
  fix: boolean;
  comment: boolean;
  findingLimit: { source: 'inherited' } | { source: 'user-supplied'; value: MaxFindings };
  context?: string;
  workingDirectory?: string;
  timeoutSeconds: number;
  cloudPost?: 'post' | 'no-post';
}

export class InputValidationError extends Error {
  override name = 'InputValidationError';
}

function fail(message: string): never {
  throw new InputValidationError(message);
}

function object(value: unknown, label: string, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail(`${label} must be an object.`);
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) fail(`Unknown ${label} field: ${key}. Raw CLI arguments are not supported.`);
  }
  return value as Record<string, unknown>;
}

function nonempty(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
    fail(`${label} must be a nonempty string without NUL characters.`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    fail(`${label} must be a positive safe integer.`);
  }
  return value;
}

export function validateRepository(value: unknown): string {
  const repository = nonempty(value, 'repository');
  if (/\s/.test(repository) || !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9_.-]+$/.test(repository)
    || ['.', '..'].includes(repository.split('/')[1]!)) {
    fail('repository must be owner/repo, not a URL or path.');
  }
  return repository;
}

function target(value: unknown): ReviewTarget {
  const candidate = object(value, 'target', ['kind', 'number', 'repository', 'url', 'value']);
  switch (candidate.kind) {
    case 'pr': {
      object(value, 'pr target', ['kind', 'number', 'repository']);
      return {
        kind: 'pr', number: positiveInteger(candidate.number, 'PR number'),
        ...(candidate.repository !== undefined ? { repository: validateRepository(candidate.repository) } : {}),
      };
    }
    case 'pr-url':
      object(value, 'pr-url target', ['kind', 'url']);
      return { kind: 'pr-url', url: nonempty(candidate.url, 'PR URL') };
    case 'branch':
    case 'path':
      object(value, `${candidate.kind} target`, ['kind', 'value']);
      return { kind: candidate.kind, value: nonempty(candidate.value, 'Target value') };
    default:
      return fail('target.kind must be pr, pr-url, branch, or path; omit target for the current diff.');
  }
}

/** No filesystem access, subprocesses, setting inheritance, or context interpretation. */
export function normalizeInput(value: unknown): NormalizedInput {
  const input = object(value, 'input', [
    'target', 'effort', 'fix', 'comment', 'maxFindings', 'context',
    'workingDirectory', 'timeoutSeconds', 'cloudPost',
  ]);
  const effort = input.effort ?? 'medium';
  if (input.effort === null || ![...LOCAL_EFFORTS, 'ultra'].includes(effort as Effort)) {
    fail('effort must be low, medium, high, xhigh, max, or manual-only ultra.');
  }
  for (const key of ['fix', 'comment']) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') fail(`${key} must be a boolean.`);
  }
  let findingLimit: NormalizedInput['findingLimit'] = { source: 'inherited' };
  if (input.maxFindings !== undefined) {
    const value = input.maxFindings === 'all' || input.maxFindings === 'default'
      ? input.maxFindings : positiveInteger(input.maxFindings, 'maxFindings');
    findingLimit = { source: 'user-supplied', value };
  }
  if (input.context !== undefined && typeof input.context !== 'string') fail('context must be a string.');
  const timeoutSeconds = input.timeoutSeconds === undefined ? 1200 : input.timeoutSeconds;
  if (typeof timeoutSeconds !== 'number' || !Number.isFinite(timeoutSeconds)
    || timeoutSeconds < 1 || timeoutSeconds > 3600) fail('timeoutSeconds must be a number from 1 to 3600.');
  if (input.cloudPost !== undefined && input.cloudPost !== 'post' && input.cloudPost !== 'no-post') {
    fail('cloudPost must be post or no-post (manual-only).');
  }
  if (input.cloudPost !== undefined && effort !== 'ultra') {
    fail('cloudPost is incompatible with local effort. Manual /code-review ultra --post or --no-post requires claude.ai access and may incur billing.');
  }
  return {
    ...(input.target !== undefined ? { target: target(input.target) } : {}),
    effort: effort as Effort,
    effortSource: input.effort === undefined ? 'defaulted' : 'user-supplied',
    fix: input.fix === true,
    comment: input.comment === true,
    findingLimit,
    ...(input.context !== undefined ? { context: input.context as string } : {}),
    ...(input.workingDirectory !== undefined ? { workingDirectory: nonempty(input.workingDirectory, 'workingDirectory') } : {}),
    timeoutSeconds,
    ...(input.cloudPost !== undefined ? { cloudPost: input.cloudPost as 'post' | 'no-post' } : {}),
  };
}
