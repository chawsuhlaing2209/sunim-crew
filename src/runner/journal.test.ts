import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  TIMEOUT_STRIKES,
  describeDelegation,
  describeFlag,
  fileJournal,
  memoryJournal,
  repeatedTimeouts,
  watch,
} from './journal.js';
import type { DelegationRecord, Delegator } from './journal.js';
import type { DelegateOptions, DelegateResult } from './types.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sunim-journal-'));
  dirs.push(dir);
  return dir;
}

function record(patch: Partial<DelegationRecord> = {}): DelegationRecord {
  return {
    at: '2026-08-15T09:00:00.000Z',
    agent: 'Engineer',
    label: 'Button-implementation',
    ok: true,
    timedOut: false,
    durationMs: 412_000,
    costUsd: 1.2,
    logPath: '/tmp/logs/button.log',
    error: undefined,
    ...patch,
  };
}

function runner(results: Partial<DelegateResult>[]): Delegator {
  const queue = [...results];
  return {
    delegate(options: DelegateOptions) {
      const next = queue.shift() ?? {};
      return Promise.resolve({
        label: options.label,
        ok: true,
        exitCode: 0,
        signal: null,
        timedOut: false,
        durationMs: 1000,
        promptPath: '/tmp/p.md',
        logPath: '/tmp/p.log',
        result: 'done',
        structuredOutput: undefined,
        sessionId: 's',
        costUsd: 0.1,
        error: undefined,
        ...next,
      } satisfies DelegateResult);
    },
  };
}

const options = (label: string, agent: string): DelegateOptions => ({
  label,
  agent,
  brief: '# Brief',
  task: 'Do the thing.',
  cwd: '/tmp/design-system',
});

describe('one line per delegation', () => {
  it('says who, how long, and how it went', () => {
    expect(describeDelegation(record())).toContain('Engineer');
    expect(describeDelegation(record())).toContain('412s');
    expect(describeDelegation(record())).toContain('$1.20');
    expect(
      describeDelegation(record({ ok: false, error: 'exit 1' })),
    ).toContain('exit 1');
    expect(describeDelegation(record({ timedOut: true }))).toContain(
      'timed out',
    );
  });

  it('is written for every delegation, finished or not', async () => {
    const journal = memoryJournal();
    const watched = watch(runner([{ ok: false, timedOut: true }]), {
      journal,
      onLine: () => undefined,
    });

    await watched.delegate(options('Button-test', 'QA'));

    const [entry] = await journal.all();
    expect(entry?.agent).toBe('QA');
    expect(entry?.timedOut).toBe(true);
  });

  it('falls back to the label when nobody named the agent', async () => {
    const journal = memoryJournal();
    const watched = watch(runner([{}]), { journal, onLine: () => undefined });

    await watched.delegate({
      label: 'Button-implementation',
      brief: '#',
      task: 'x',
      cwd: '/tmp',
    });

    expect((await journal.all())[0]?.agent).toBe('Button-implementation');
  });
});

describe('a journal on disk', () => {
  it('appends, and reads back what it appended', async () => {
    const path = join(await tempDir(), 'nested', 'delegations.jsonl');
    const journal = fileJournal(path);

    await journal.record(record());
    await journal.record(record({ label: 'Card-implementation' }));

    expect((await journal.all()).map((entry) => entry.label)).toEqual([
      'Button-implementation',
      'Card-implementation',
    ]);
    expect((await readFile(path, 'utf8')).trim().split('\n')).toHaveLength(2);
  });

  it('reads what it can when a line was cut off mid write', async () => {
    const path = join(await tempDir(), 'delegations.jsonl');
    // A sweep killed partway through writing its second line.
    await writeFile(
      path,
      `${JSON.stringify(record())}\n{"agent":"Engineer","label":"Card-imp`,
      'utf8',
    );

    const entries = await fileJournal(path).all();

    expect(entries).toHaveLength(1);
    expect(entries[0]?.label).toBe('Button-implementation');
  });

  it('is empty, not broken, before the first sweep', async () => {
    const journal = fileJournal(join(await tempDir(), 'nothing.jsonl'));

    expect(await journal.all()).toEqual([]);
  });
});

describe('an agent that keeps timing out', () => {
  const timedOut = (label: string): DelegationRecord =>
    record({ label, ok: false, timedOut: true, error: 'timed out' });

  it('is flagged on the second time in a row', () => {
    const flags = repeatedTimeouts([
      timedOut('Button-implementation'),
      timedOut('Card-implementation'),
    ]);

    expect(flags).toHaveLength(1);
    expect(flags[0]?.agent).toBe('Engineer');
    expect(flags[0]?.labels).toEqual([
      'Button-implementation',
      'Card-implementation',
    ]);
  });

  it('is not flagged for one timeout, or for one that recovered', () => {
    expect(repeatedTimeouts([timedOut('Button-implementation')])).toEqual([]);
    expect(
      repeatedTimeouts([
        timedOut('Button-implementation'),
        record({ label: 'Card-implementation' }),
      ]),
    ).toEqual([]);
  });

  it('counts the run per agent, not across all of them', () => {
    const flags = repeatedTimeouts([
      timedOut('Button-implementation'),
      { ...timedOut('Button-test'), agent: 'QA' },
    ]);

    expect(flags).toEqual([]);
  });

  it('is caught across sweeps, because the journal outlives the process', async () => {
    // Yesterday's sweep left one timeout behind. Today's makes it two.
    const journal = memoryJournal([timedOut('Button-implementation')]);
    const lines: string[] = [];
    const watched = watch(runner([{ ok: false, timedOut: true }]), {
      journal,
      onLine: (line) => lines.push(line),
    });

    await watched.delegate(options('Card-implementation', 'Engineer'));

    expect(watched.flags).toHaveLength(1);
    expect(lines.join('\n')).toContain('FLAG');
  });

  it('is flagged and still run, because stopping quietly looks like nothing wrong', async () => {
    const journal = memoryJournal([timedOut('Button-implementation')]);
    const watched = watch(
      runner([{ ok: true, result: 'finished this time' }]),
      {
        journal,
        onLine: () => undefined,
      },
    );

    const result = await watched.delegate(
      options('Card-implementation', 'Engineer'),
    );

    expect(result.result).toBe('finished this time');
  });

  it('says what it is flagging and why', () => {
    const text = describeFlag({
      agent: 'Engineer',
      count: TIMEOUT_STRIKES,
      labels: ['Button-implementation', 'Card-implementation'],
    });

    expect(text).toContain('Engineer');
    expect(text).toContain('2 times in a row');
    expect(text).toContain('Read the last log');
  });
});
