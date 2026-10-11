import { InputValidationError, LOCAL_EFFORTS, normalizeInput } from './inputs.js';
import type { NormalizedInput } from './inputs.js';
import { canonicalPrUrl, resolveTarget } from './targets.js';
import type { TargetEnvironment } from './targets.js';

const RESERVED = new Set<string>([...LOCAL_EFFORTS, 'ultra', 'all', 'default']);

/** Conservative operator-approved grammar. Slash-command parsing is not shell parsing. */
export function encodeTarget(value: string): string {
  const tokens = value.split(' ');
  if (!value || value !== value.trim() || !/^[A-Za-z0-9_./ -]+$/.test(value)
    || /[\x00-\x1f\x7f]/.test(value)
    || tokens.some(token => token.startsWith('-') || RESERVED.has(token))
    || /^\d+$/.test(value)) {
    throw new InputValidationError('Target cannot be represented by the conservative slash-command encoding. Use ASCII letters, digits, underscore, dot, slash, hyphen, and internal spaces only; no bare numbers, standalone effort/limit words, flag-like tokens, control characters, or shell quoting. For a reserved path such as high, supply ./high explicitly. Otherwise use a supported equivalent or review the current diff. Target text is never corrected automatically.');
  }
  return value;
}

export function rejectCloud(input: NormalizedInput): void {
  if (input.effort === 'ultra' || input.cloudPost !== undefined) {
    const option = input.cloudPost ? ` --${input.cloudPost}` : '';
    throw new InputValidationError(`Cloud review is manual-only; no Claude review was launched and no local effort was substituted. In an interactive Claude session, invoke /code-review ultra${option} with your intended target. It requires claude.ai access and may incur billing; posting can be disabled by server-side settings.`);
  }
}

export function buildCommand(input: NormalizedInput, resolvedTarget?: string): string {
  rejectCloud(input);
  if ((input.target === undefined) !== (resolvedTarget === undefined)) {
    throw new InputValidationError('A supplied target must be resolved before command construction.');
  }
  const args: string[] = ['/code-review', input.effort];
  if (input.fix) args.push('--fix');
  if (input.comment) args.push('--comment');
  if (input.findingLimit.source === 'user-supplied') args.push('--max-findings', String(input.findingLimit.value));
  if (resolvedTarget !== undefined) {
    args.push(input.target?.kind === 'pr' || input.target?.kind === 'pr-url'
      ? canonicalPrUrl(resolvedTarget) : encodeTarget(resolvedTarget));
  }
  return args.join(' ');
}

/** Cloud and target validation precede any repository-lookup subprocess. */
export async function prepareCommand(raw: unknown, environment: TargetEnvironment): Promise<{ input: NormalizedInput; target?: string; command: string }> {
  const input = normalizeInput(raw);
  rejectCloud(input);
  if (input.target?.kind === 'path' || input.target?.kind === 'branch') encodeTarget(input.target.value);
  const target = await resolveTarget(input.target, environment);
  return { input, ...(target !== undefined ? { target } : {}), command: buildCommand(input, target) };
}
