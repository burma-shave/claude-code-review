import { Type } from 'typebox';
import type { RunResult } from './runner.js';

const nullableString = Type.Union([Type.String(), Type.Null()]);
export const EffortSchema = Type.Union([Type.Literal('low'), Type.Literal('medium'), Type.Literal('high'), Type.Literal('xhigh'), Type.Literal('max'), Type.Literal('ultra')]);
const findingValue = Type.Union([Type.Integer({ minimum: 1 }), Type.Literal('all'), Type.Literal('default')]);
export const TargetSchema = Type.Union([
  Type.Object({ kind: Type.Literal('pr'), number: Type.Integer({ minimum: 1 }), repository: Type.Optional(Type.String()) }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('pr-url'), url: Type.String() }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('branch'), value: Type.String() }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('path'), value: Type.String() }, { additionalProperties: false }),
]);

/** Supplementary context is intentionally not duplicated in structured metadata. */
export const ResultSchema = Type.Object({
  status: Type.Union(['completed', 'failed', 'cancelled', 'timed-out'].map(value => Type.Literal(value))),
  selectedTarget: Type.Union([TargetSchema, Type.Null()]),
  target: nullableString,
  options: Type.Union([Type.Null(), Type.Object({
    effort: EffortSchema, effortSource: Type.Union([Type.Literal('defaulted'), Type.Literal('user-supplied')]),
    fix: Type.Boolean(), comment: Type.Boolean(),
    findingLimit: Type.Union([
      Type.Object({ source: Type.Literal('inherited') }, { additionalProperties: false }),
      Type.Object({ source: Type.Literal('user-supplied'), value: findingValue }, { additionalProperties: false }),
    ]),
    timeoutSeconds: Type.Number({ minimum: 1, maximum: 3600 }),
    cloudPost: Type.Optional(Type.Union([Type.Literal('post'), Type.Literal('no-post')])),
  }, { additionalProperties: false })]),
  cwd: Type.String(),
  version: Type.Object({
    status: Type.Union(['reported', 'unrecognized', 'unavailable'].map(value => Type.Literal(value))),
    version: nullableString, raw: Type.String(), diagnostic: nullableString,
  }, { additionalProperties: false }),
  durationMs: Type.Number({ minimum: 0 }),
  exitCode: Type.Union([Type.Integer(), Type.Null()]), exitSignal: nullableString,
  logs: Type.Union([Type.Null(), Type.Object({ directory: Type.String(), stdout: Type.String(), stderr: Type.String() }, { additionalProperties: false })]),
  diagnostic: nullableString,
}, { additionalProperties: false });

export function resultMetadata(run: RunResult) {
  const input = run.input;
  return {
    status: run.status, selectedTarget: input?.target ?? null, target: run.target,
    options: input ? {
      effort: input.effort, effortSource: input.effortSource, fix: input.fix, comment: input.comment,
      findingLimit: input.findingLimit, timeoutSeconds: input.timeoutSeconds,
      ...(input.cloudPost ? { cloudPost: input.cloudPost } : {}),
    } : null,
    cwd: run.cwd, version: { ...run.version }, durationMs: run.durationMs,
    exitCode: run.exitCode, exitSignal: run.exitSignal, logs: run.logs ? { ...run.logs } : null, diagnostic: run.diagnostic,
  };
}

export const DISPLAY_MAX_LINES = 2000;
export const DISPLAY_MAX_BYTES = 50 * 1024;

/** Bound the entire response, including notices, without splitting UTF-8 code points. */
export function displayResult(run: RunResult): string {
  const prefix = `Review status: ${run.status}\n`;
  const notice = '\n[Output truncated; read full logs.]';
  const rawFooter = run.logs
    ? `\nFull stdout: ${run.logs.stdout}\nFull stderr: ${run.logs.stderr}`
    : '\nNo review logs (review did not start).';
  // Paths normally fit easily; retain a bounded notice even for pathological host paths.
  const footer = boundedPrefix(rawFooter, 4096, 4).text;
  const body = [run.diagnostic, run.text].filter(Boolean).join('\n\n') || 'No readable review output.';
  const reserved = prefix + notice + footer;
  const bounded = boundedPrefix(body, DISPLAY_MAX_BYTES - Buffer.byteLength(reserved),
    DISPLAY_MAX_LINES - reserved.split('\n').length + 1);
  return prefix + bounded.text + (bounded.truncated ? notice : '') + footer;
}

function boundedPrefix(text: string, maxBytes: number, maxLines: number): { text: string; truncated: boolean } {
  let bytes = 0;
  let lines = 1;
  let end = 0;
  for (const character of text) {
    const size = Buffer.byteLength(character);
    if (bytes + size > maxBytes || (character === '\n' && lines >= maxLines)) break;
    bytes += size;
    if (character === '\n') lines++;
    end += character.length;
  }
  return { text: text.slice(0, end), truncated: end < text.length };
}

export function toolResult(run: RunResult) {
  const metadata = resultMetadata(run);
  return {
    content: [{ type: 'text' as const, text: displayResult(run) }],
    details: metadata, structuredContent: metadata, isError: run.status !== 'completed',
  };
}
