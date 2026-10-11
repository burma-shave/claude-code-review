import { open } from 'node:fs/promises';
import type { Writable } from 'node:stream';

export interface LogPaths {
  directory: string;
  stdout: string;
  stderr: string;
}

/** Exclusive creation in a unique private directory; never follows an existing log symlink. */
export async function openRunLogs(logs: LogPaths): Promise<{ stdout: Writable; stderr: Writable }> {
  const stdout = await open(logs.stdout, 'wx', 0o600);
  try {
    const stderr = await open(logs.stderr, 'wx', 0o600);
    return { stdout: stdout.createWriteStream(), stderr: stderr.createWriteStream() };
  } catch (error) {
    await stdout.close();
    throw error;
  }
}
