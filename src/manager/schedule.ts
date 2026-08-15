import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * When the crew wakes up. One definition, in one file.
 *
 * docs/security-checklist.md: "The manager sweep runs in one place so there
 * is a single writer of evidence." Two schedules would be two writers, and
 * two writers racing on the same component is how a component gets its
 * evidence written twice and its subtask completed and reopened in the same
 * minute. So the crontab line, the lock and the interval all come from here.
 */
export const SWEEP_SCHEDULE = {
  minute: 0,
  hour: 9,
  cron: '0 9 * * *',
  description: 'once a day at 09:00, in the machine timezone',
} as const;

/** The lock file, beside the logs, so a run leaves everything in one place. */
export const LOCK_FILE = 'sweep.lock';

/**
 * A lock older than this is treated as abandoned. Longer than any sweep can
 * legitimately take: the longest single delegation is the engineer at 45
 * minutes, and a sweep runs them one after another, so this is generous on
 * purpose. A stale lock that is honoured for too long is a crew that quietly
 * stops working; one that is broken too early is two writers.
 */
export const LOCK_STALE_MS = 6 * 60 * 60 * 1000;

interface LockContents {
  readonly pid: number;
  readonly at: string;
  readonly host?: string;
}

export interface LockDeps {
  readonly now?: () => number;
  readonly pid?: number;
  readonly host?: string;
  /** Whether that process is still there. Injected so a test can say. */
  readonly alive?: (pid: number) => boolean;
}

export type Locked<T> =
  | { readonly ran: true; readonly value: T }
  | { readonly ran: false; readonly heldBy: string };

function running(pid: number): boolean {
  try {
    // Signal 0 checks for the process without touching it.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run this, and only this, and only one of it.
 *
 * A second sweep starting while the first is still going does not queue and
 * does not wait. It says who holds the lock and stops. The daily routine can
 * then overlap with a sweep somebody started by hand without either of them
 * writing over the other.
 */
export async function withSingleWriter<T>(
  path: string,
  run: () => Promise<T>,
  deps: LockDeps = {},
): Promise<Locked<T>> {
  const now = deps.now ?? (() => Date.now());
  const pid = deps.pid ?? process.pid;
  const alive = deps.alive ?? running;

  const take = async (): Promise<boolean> => {
    await mkdir(dirname(path), { recursive: true });
    try {
      const handle = await open(path, 'wx');
      const contents: LockContents = {
        pid,
        at: new Date(now()).toISOString(),
        ...(deps.host === undefined ? {} : { host: deps.host }),
      };
      await handle.writeFile(JSON.stringify(contents), 'utf8');
      await handle.close();
      return true;
    } catch {
      return false;
    }
  };

  if (!(await take())) {
    const held = await describeHolder(path);

    // Nobody is behind it, or it is old enough that nobody can be. A machine
    // that was rebooted mid sweep leaves exactly this behind, and a crew that
    // never runs again until somebody notices a file is worse than a crew
    // that takes an abandoned lock.
    const stale =
      held === undefined ||
      !alive(held.pid) ||
      now() - Date.parse(held.at) > LOCK_STALE_MS;

    if (!stale) {
      return {
        ran: false,
        heldBy: `pid ${held.pid}${held.host === undefined ? '' : ` on ${held.host}`}, since ${held.at}`,
      };
    }

    await rm(path, { force: true });
    if (!(await take())) {
      return { ran: false, heldBy: 'another sweep took the lock first' };
    }
  }

  try {
    return { ran: true, value: await run() };
  } finally {
    await rm(path, { force: true });
  }
}

async function describeHolder(path: string): Promise<LockContents | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as LockContents;
    return typeof parsed.pid === 'number' && typeof parsed.at === 'string'
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The daily entry, built from the one schedule above. Printed rather than
 * installed silently: a scheduled job that appears on somebody's machine
 * without them putting it there is a surprise, and this one spends money.
 */
export function crontabLine(dir: string, logPath: string): string {
  return `${SWEEP_SCHEDULE.cron} cd '${dir}' && /usr/bin/env npm run --silent sweep >> '${logPath}' 2>&1`;
}
