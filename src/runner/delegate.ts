import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { childEnv } from './env.js';
import { CLI_BINARY, buildArgs, outputFormatFor } from './flags.js';
import type { DelegateOptions, DelegateResult } from './types.js';

export type SpawnFn = typeof nodeSpawn;

export interface DelegateDeps {
  readonly spawn?: SpawnFn;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly now?: () => number;
  /** For a readable, repeatable run id in tests. */
  readonly stamp?: () => string;
}

export const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

/** How long a process gets to die politely before it is killed outright. */
export const KILL_GRACE_MS = 5000;

const SAFE = /[^a-z0-9._-]+/gi;

export function runId(label: string, stamp: string): string {
  return `${stamp}-${label.replace(SAFE, '-').toLowerCase()}`.slice(0, 120);
}

/**
 * The whole prompt, written down before anything runs. The brief says what the
 * craft is, the task says which piece of work this is. Having it on disk means
 * a delegation can be read back, or replayed by hand, without guessing what
 * the worker was told.
 */
export function composePrompt(options: DelegateOptions): string {
  return [
    options.brief.trim(),
    '',
    '---',
    '',
    '# This delegation',
    '',
    options.task.trim(),
    '',
  ].join('\n');
}

interface ResultEvent {
  readonly result?: string;
  readonly structured_output?: unknown;
  readonly session_id?: string;
  readonly total_cost_usd?: number;
  readonly is_error?: boolean;
  readonly subtype?: string;
}

/**
 * Read the child's answer out of what it printed. stream-json ends with a
 * result event on its own line; json prints one document. Anything else is
 * left alone, and the caller sees an undefined result rather than a guess.
 */
export function readFinal(
  output: string,
  format: 'json' | 'stream-json',
): ResultEvent {
  if (format === 'json') {
    try {
      return JSON.parse(output) as ResultEvent;
    } catch {
      return {};
    }
  }

  for (const line of output.split(/\r?\n/).reverse()) {
    const trimmed = line.trim();
    if (trimmed === '' || !trimmed.startsWith('{')) continue;
    try {
      const event = JSON.parse(trimmed) as { type?: string } & ResultEvent;
      if (event.type === 'result') return event;
    } catch {
      continue;
    }
  }
  return {};
}

/**
 * Spawn one Claude Code process for one piece of work, and wait for it.
 *
 * One process per delegation, nothing shared. The prompt is on disk before the
 * process starts, everything it prints goes to a log as it happens, and a hard
 * timeout kills the whole process group rather than leaving an orphan behind.
 */
export async function delegate(
  options: DelegateOptions,
  deps: DelegateDeps = {},
): Promise<DelegateResult> {
  const spawn = deps.spawn ?? nodeSpawn;
  const parentEnv = deps.env ?? process.env;
  const now = deps.now ?? (() => Date.now());
  const stamp =
    deps.stamp ?? (() => new Date().toISOString().replace(/[:.]/g, '-'));

  const runDir = options.runDir ?? join(process.cwd(), 'logs');
  const id = runId(options.label, stamp());
  const promptPath = join(runDir, `${id}.prompt.md`);
  const logPath = join(runDir, `${id}.log`);

  await mkdir(runDir, { recursive: true });
  const prompt = composePrompt(options);
  await writeFile(promptPath, prompt, 'utf8');

  const format = outputFormatFor(options);
  const args = buildArgs(options);
  const env = childEnv(parentEnv, {
    ...(options.allowEnv === undefined ? {} : { allow: options.allowEnv }),
  });

  const started = now();
  const log = createWriteStream(logPath, { flags: 'a' });
  log.write(`# ${CLI_BINARY} ${args.join(' ')}\n# prompt: ${promptPath}\n\n`);

  let child: ChildProcess;
  try {
    child = spawn(CLI_BINARY, args, {
      cwd: options.cwd,
      env,
      // Its own process group, so a timeout can take the whole tree.
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    log.end();
    return {
      label: options.label,
      ok: false,
      exitCode: null,
      signal: null,
      timedOut: false,
      durationMs: now() - started,
      promptPath,
      logPath,
      result: undefined,
      structuredOutput: undefined,
      sessionId: undefined,
      costUsd: undefined,
      error: `could not start ${CLI_BINARY}: ${String(error)}`,
    };
  }

  let stdout = '';
  child.stdout?.on('data', (chunk: Buffer | string) => {
    const text = String(chunk);
    stdout += text;
    log.write(text);
  });
  child.stderr?.on('data', (chunk: Buffer | string) => {
    log.write(String(chunk));
  });

  // The prompt goes in on stdin rather than argv, so a long brief cannot run
  // into an argument length limit.
  child.stdin?.end(prompt);

  let timedOut = false;
  const killTree = (signal: NodeJS.Signals): void => {
    if (child.pid === undefined) return;
    try {
      // Negative pid is the process group, so a worker's own child processes
      // go with it instead of being orphaned.
      process.kill(-child.pid, signal);
    } catch {
      try {
        child.kill(signal);
      } catch {
        // Already gone.
      }
    }
  };

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let hardKill: NodeJS.Timeout | undefined;
  const timer = setTimeout(() => {
    timedOut = true;
    log.write(`\n# timed out after ${timeoutMs}ms, terminating\n`);
    killTree('SIGTERM');
    hardKill = setTimeout(() => {
      log.write('# still alive after the grace period, killing\n');
      killTree('SIGKILL');
    }, KILL_GRACE_MS);
    hardKill.unref?.();
  }, timeoutMs);
  timer.unref?.();

  const closed = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    error?: Error;
  }>((resolve) => {
    child.once('error', (error: Error) => {
      resolve({ code: null, signal: null, error });
    });
    child.once(
      'close',
      (code: number | null, signal: NodeJS.Signals | null) => {
        resolve({ code, signal });
      },
    );
  });

  clearTimeout(timer);
  if (hardKill !== undefined) clearTimeout(hardKill);
  await new Promise<void>((resolve) => log.end(resolve));

  const final = readFinal(stdout, format);
  const durationMs = now() - started;
  const ok =
    !timedOut &&
    closed.error === undefined &&
    closed.code === 0 &&
    final.is_error !== true;

  return {
    label: options.label,
    ok,
    exitCode: closed.code,
    signal: closed.signal,
    timedOut,
    durationMs,
    promptPath,
    logPath,
    result: final.result,
    structuredOutput: final.structured_output,
    sessionId: final.session_id,
    costUsd: final.total_cost_usd,
    error: timedOut
      ? `timed out after ${timeoutMs}ms`
      : closed.error !== undefined
        ? String(closed.error)
        : ok
          ? undefined
          : `exit ${String(closed.code)}${final.subtype === undefined ? '' : `, ${final.subtype}`}`,
  };
}
