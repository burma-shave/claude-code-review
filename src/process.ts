import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

/** Idempotent termination of this launch's process group/tree, never all Claude processes. */
export function processTreeStopper(child: ChildProcess, onError: (error: Error) => void): () => Promise<void> {
  let stopping: Promise<void> | undefined;
  return () => stopping ??= (async () => {
    const pid = child.pid;
    if (!pid) return;
    if (process.platform === 'win32') {
      await new Promise<void>(done => {
        const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
        const timer = setTimeout(() => { killer.kill(); child.kill(); onError(new Error('Process-tree termination timed out.')); }, 2000);
        killer.once('error', error => { onError(error); child.kill(); });
        killer.once('close', code => {
          clearTimeout(timer);
          if (code !== 0) { onError(new Error(`taskkill exited ${code}`)); child.kill(); }
          done();
        });
      });
    } else {
      const kill = (signal: NodeJS.Signals) => {
        try { process.kill(-pid, signal); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') onError(error as Error); }
      };
      kill('SIGTERM');
      await new Promise(done => setTimeout(done, 100));
      kill('SIGKILL');
    }
  })();
}

export interface BoundedExecution {
  stdout: string;
  stderr: string;
  error: Error | null;
}

/** Small diagnostic/lookup subprocesses: bounded capture and owned-tree cancellation. */
export async function executeBounded(executable: string, args: string[], options: {
  cwd: string; timeoutMs: number; maxBytes: number; signal?: AbortSignal;
}): Promise<BoundedExecution> {
  options.signal?.throwIfAborted();
  const child = spawn(executable, args, {
    cwd: options.cwd, shell: false, detached: process.platform !== 'win32', windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let error: Error | null = null;
  const stop = processTreeStopper(child, failure => { error ??= failure; });
  let stopPromise: Promise<void> | undefined;
  const terminate = () => { stopPromise ??= stop(); };
  const abort = () => { error ??= new Error('Execution aborted.'); terminate(); };
  const timer = setTimeout(() => { error ??= new Error('Subprocess timed out.'); terminate(); }, options.timeoutMs);
  options.signal?.addEventListener('abort', abort, { once: true });
  const buffers: { stdout: Buffer[]; stderr: Buffer[] } = { stdout: [], stderr: [] };
  const sizes = { stdout: 0, stderr: 0 };
  for (const name of ['stdout', 'stderr'] as const) {
    child[name].on('data', (chunk: Buffer) => {
      const remaining = options.maxBytes - sizes[name];
      if (remaining > 0) {
        const retained = Buffer.from(chunk.subarray(0, remaining));
        buffers[name].push(retained);
        sizes[name] += retained.length;
      }
      if (chunk.length > remaining) { error ??= new Error('Subprocess output exceeded the capture bound.'); terminate(); }
    });
  }
  try {
    const closed = new Promise<void>(done => {
      child.once('error', failure => { error ??= failure; });
      child.once('close', (code, signal) => {
        if (code !== 0) error ??= new Error(`Subprocess exited ${code ?? signal ?? 'without status'}.`);
        done();
      });
    });
    if (options.signal?.aborted) abort();
    await closed;
    await stopPromise;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
  return {
    stdout: Buffer.concat(buffers.stdout, sizes.stdout).toString('utf8'),
    stderr: Buffer.concat(buffers.stderr, sizes.stderr).toString('utf8'), error,
  };
}
