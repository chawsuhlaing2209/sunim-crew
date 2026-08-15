import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LOCK_STALE_MS,
  SWEEP_SCHEDULE,
  crontabLine,
  withSingleWriter,
} from './schedule.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});

async function lockPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sunim-lock-'));
  dirs.push(dir);
  const runs = join(dir, 'runs');
  await mkdir(runs, { recursive: true });
  return join(runs, 'sweep.lock');
}

/** A lock somebody left behind, as if a sweep were still holding it. */
async function held(
  path: string,
  pid: number,
  at: number = Date.now(),
): Promise<void> {
  await writeFile(
    path,
    JSON.stringify({ pid, at: new Date(at).toISOString() }),
    'utf8',
  );
}

describe('the schedule', () => {
  it('is one definition, and the crontab line comes from it', () => {
    const line = crontabLine('/somewhere/sunim-crew', '/somewhere/sweep.log');

    expect(line.startsWith(SWEEP_SCHEDULE.cron)).toBe(true);
    expect(line).toContain('npm run --silent sweep');
    expect(line).toContain('>>');
  });

  it('runs daily, so a component never waits more than a day for a look', () => {
    expect(SWEEP_SCHEDULE.cron.split(' ')).toHaveLength(5);
    expect(SWEEP_SCHEDULE.cron).toBe(
      `${SWEEP_SCHEDULE.minute} ${SWEEP_SCHEDULE.hour} * * *`,
    );
  });
});

describe('one writer of evidence', () => {
  it('runs the work and cleans up after itself', async () => {
    const path = await lockPath();

    const result = await withSingleWriter(path, () => Promise.resolve(7));

    expect(result).toEqual({ ran: true, value: 7 });
    await expect(readFile(path, 'utf8')).rejects.toThrow();
  });

  it('lets the lock go even when the sweep throws', async () => {
    const path = await lockPath();

    await expect(
      withSingleWriter(path, () =>
        Promise.reject(new Error('the base is down')),
      ),
    ).rejects.toThrow('the base is down');
    await expect(readFile(path, 'utf8')).rejects.toThrow();
  });

  it('refuses a second sweep while the first is still going', async () => {
    const path = await lockPath();
    let inner: unknown;

    await withSingleWriter(path, async () => {
      inner = await withSingleWriter(path, () => Promise.resolve('wrote'), {
        alive: () => true,
      });
    });

    expect(inner).toMatchObject({ ran: false });
    expect((inner as { heldBy: string }).heldBy).toContain('pid');
  });

  it('takes a lock left behind by a process that is gone', async () => {
    const path = await lockPath();
    // What a machine rebooted mid sweep leaves behind.
    await held(path, 4242);

    const result = await withSingleWriter(path, () => Promise.resolve('ran'), {
      alive: (pid) => pid !== 4242,
    });

    expect(result).toEqual({ ran: true, value: 'ran' });
  });

  it('takes a lock old enough that nobody can still be behind it', async () => {
    const path = await lockPath();
    await held(path, 1, Date.now() - LOCK_STALE_MS - 1000);

    const result = await withSingleWriter(path, () => Promise.resolve('ran'), {
      // Still alive, and still holding a lock from six hours ago. Something
      // is stuck, and waiting on it forever is how the crew stops working.
      alive: () => true,
    });

    expect(result).toEqual({ ran: true, value: 'ran' });
  });

  it('records who holds it, so a person can go and look', async () => {
    const path = await lockPath();

    await withSingleWriter(
      path,
      async () => {
        const held = JSON.parse(await readFile(path, 'utf8')) as {
          pid: number;
          host?: string;
        };
        expect(held.pid).toBe(process.pid);
        expect(held.host).toBe('somebody-laptop');
      },
      { host: 'somebody-laptop' },
    );
  });
});
