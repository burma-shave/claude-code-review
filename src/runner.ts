import { spawn } from 'node:child_process';
import { mkdtemp, realpath, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { finished } from 'node:stream/promises';
import { probeClaudeVersion } from './claude.js';
import type { VersionDiagnostic } from './claude.js';
import { ResultDecoder } from './decoder.js';
import { InputValidationError, normalizeInput } from './inputs.js';
import type { NormalizedInput } from './inputs.js';
import { prepareCommand, rejectCloud } from './invocation.js';
import { REVIEW_ARGV, serializeReviewMessage } from './transport.js';
import { openRunLogs } from './logs.js';
import type { LogPaths } from './logs.js';
import { processTreeStopper } from './process.js';

export interface RunEnvironment {
  cwd: string;
  signal?: AbortSignal;
  /** Internal injection only; never exposed in tool inputs. */
  executable?: string;
  ghExecutable?: string;
  /** Internal log-failure injection, not a tool input. */
  openLogs?: typeof openRunLogs;
}

export interface RunResult {
  status: 'completed' | 'failed' | 'cancelled' | 'timed-out';
  input: NormalizedInput | null;
  target: string | null;
  cwd: string;
  version: VersionDiagnostic;
  durationMs: number;
  exitCode: number | null;
  exitSignal: string | null;
  logs: LogPaths | null;
  text: string;
  diagnostic: string | null;
}

const unavailableVersion = (): VersionDiagnostic => ({ status: 'unavailable', version: null, raw: '', diagnostic: null });
const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

async function runChild(executable: string, cwd: string, stdin: string, signal: AbortSignal, logs: LogPaths, openLogs: typeof openRunLogs) {
  signal.throwIfAborted();
  let streams;
  try { streams = await openLogs(logs); }
  catch (error) { throw new Error(`Log setup failed: ${message(error)}`); }
  const { stdout: stdoutLog, stderr: stderrLog } = streams;
  const decoder = new ResultDecoder();
  let diagnostic: string | null = null;
  let stderr = '';
  let stopPromise: Promise<void> | undefined;
  let child: ReturnType<typeof spawn> | undefined;
  let stopTree: (() => Promise<void>) | undefined;
  const stop = (): Promise<void> => stopPromise ??= stopTree?.() ?? Promise.resolve();
  const logError = (error: Error) => { diagnostic ??= `Log write failed: ${error.message}`; void stop(); };
  stdoutLog.on('error', logError);
  stderrLog.on('error', logError);
  const logCompletion = [finished(stdoutLog, { cleanup: true }), finished(stderrLog, { cleanup: true })]
    .map(promise => promise.catch(error => { logError(error); }));
  const aborted = () => { void stop(); };
  let exitCode: number | null = null;
  let exitSignal: string | null = null;
  try {
    signal.throwIfAborted();
    child = spawn(executable, [...REVIEW_ARGV], {
      cwd, shell: false, detached: process.platform !== 'win32', windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    stopTree = processTreeStopper(child, error => { diagnostic ??= `Process-tree termination failed: ${message(error)}`; });
    signal.addEventListener('abort', aborted, { once: true });
    const closed = new Promise<void>(done => {
      child!.once('error', error => { diagnostic ??= `Claude launch failed: ${message(error)}`; });
      child!.once('close', (code, exit) => { exitCode = code; exitSignal = exit; done(); });
    });
    child.stdout!.on('data', (chunk: Buffer) => decoder.push(chunk));
    child.stderr!.on('data', (chunk: Buffer) => { if (stderr.length < 4096) stderr += chunk.toString('utf8').slice(0, 4096 - stderr.length); });
    child.stdout!.pipe(stdoutLog);
    child.stderr!.pipe(stderrLog);
    child.stdin!.on('error', error => { diagnostic ??= `Claude stdin write failed: ${message(error)}`; void stop(); });
    child.stdin!.end(stdin);
    if (signal.aborted) void stop();
    await closed;
    await stopPromise;
  } finally {
    signal.removeEventListener('abort', aborted);
    stdoutLog.end();
    stderrLog.end();
    await Promise.all(logCompletion);
    await stopPromise;
    stdoutLog.off('error', logError);
    stderrLog.off('error', logError);
  }
  const decoded = decoder.finish();
  if (exitCode !== 0) diagnostic ??= `Claude exited ${exitCode ?? exitSignal ?? 'without status'}.${stderr ? ` ${stderr.trim()}` : ''}`;
  diagnostic ??= decoded.diagnostic;
  return { exitCode, exitSignal, text: decoded.text, diagnostic, failed: diagnostic !== null || decoded.isError };
}

/** Fresh shell-free invocation. No retries, installation, session continuation, or UI. */
export async function runReview(raw: unknown, environment: RunEnvironment): Promise<RunResult> {
  const start = Date.now();
  const result: RunResult = {
    status: 'failed', input: null, target: null, cwd: environment.cwd,
    version: unavailableVersion(), durationMs: 0, exitCode: null, exitSignal: null,
    logs: null, text: '', diagnostic: null,
  };
  const timeout = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const signal = environment.signal ? AbortSignal.any([timeout.signal, environment.signal]) : timeout.signal;
  let terminationCause: 'cancelled' | 'timed-out' | undefined;
  const terminated = () => { terminationCause ??= timeout.signal.aborted ? 'timed-out' : 'cancelled'; };
  signal.addEventListener('abort', terminated, { once: true });
  if (signal.aborted) terminated();
  try {
    const input = normalizeInput(raw);
    result.input = input;
    rejectCloud(input);
    const deadline = start + input.timeoutSeconds * 1000;
    timer = setTimeout(() => timeout.abort(), Math.max(0, deadline - Date.now()));
    signal.throwIfAborted();
    try {
      result.cwd = await realpath(resolve(environment.cwd, input.workingDirectory ?? '.'));
      if (!(await stat(result.cwd)).isDirectory()) throw new Error('not a directory');
    } catch (error) { throw new InputValidationError(`workingDirectory must be an existing directory: ${message(error)}`); }
    signal.throwIfAborted();
    const prepared = await prepareCommand(raw, {
      cwd: result.cwd, deadline, signal,
      ...(environment.ghExecutable ? { ghExecutable: environment.ghExecutable } : {}),
    });
    result.target = prepared.target ?? null;
    result.version = await probeClaudeVersion({
      cwd: result.cwd, deadline, signal,
      ...(environment.executable ? { executable: environment.executable } : {}),
    });
    signal.throwIfAborted();
    const directory = await mkdtemp(join(tmpdir(), 'pi-claude-code-review-'));
    result.logs = { directory, stdout: join(directory, 'stdout.jsonl'), stderr: join(directory, 'stderr.log') };
    const childResult = await runChild(environment.executable ?? 'claude', result.cwd,
      serializeReviewMessage(input, prepared.target), signal, result.logs, environment.openLogs ?? openRunLogs);
    result.exitCode = childResult.exitCode;
    result.exitSignal = childResult.exitSignal;
    result.text = childResult.text;
    result.diagnostic = childResult.diagnostic;
    result.status = childResult.failed ? 'failed' : 'completed';
  } catch (error) { result.diagnostic = message(error); }
  finally {
    if (timer) clearTimeout(timer);
    signal.removeEventListener('abort', terminated);
    if (terminationCause) {
      result.status = terminationCause;
      result.diagnostic ??= terminationCause === 'timed-out' ? 'Review execution timed out.' : 'Review execution was cancelled.';
    }
    result.durationMs = Date.now() - start;
  }
  return result;
}
