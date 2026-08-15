import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { DelegateOptions, DelegateResult } from './types.js';

/**
 * The runner, as the journal sees it. Structurally the same as the lanes'
 * RunnerPort, declared here so the runner does not have to import the lanes
 * that import it.
 */
export interface Delegator {
  delegate(options: DelegateOptions): Promise<DelegateResult>;
}

/** One delegation, after the fact. What it cost and how it went. */
export interface DelegationRecord {
  readonly at: string;
  /** Which agent this was, so repeats can be counted against one of them. */
  readonly agent: string;
  readonly label: string;
  readonly ok: boolean;
  readonly timedOut: boolean;
  readonly durationMs: number;
  readonly costUsd: number | undefined;
  readonly logPath: string;
  readonly error: string | undefined;
}

/**
 * Two in a row is the line. Once is a slow build or a bad afternoon. Twice
 * running is the same agent failing the same way, and the third attempt will
 * spend the same time and the same money to find that out again.
 */
export const TIMEOUT_STRIKES = 2;

export interface TimeoutFlag {
  readonly agent: string;
  readonly count: number;
  readonly labels: readonly string[];
}

export function agentOf(options: DelegateOptions): string {
  return options.agent ?? options.label;
}

export interface Journal {
  record(entry: DelegationRecord): Promise<void>;
  all(): Promise<DelegationRecord[]>;
}

/** A journal that lives only as long as the process. For tests and dry runs. */
export function memoryJournal(seed: readonly DelegationRecord[] = []): Journal {
  const entries = [...seed];
  return {
    record(entry) {
      entries.push(entry);
      return Promise.resolve();
    },
    all() {
      return Promise.resolve([...entries]);
    },
  };
}

/**
 * One JSON object per line, appended. Append-only because a sweep that dies
 * halfway should still leave behind what it already did, and because two
 * processes writing whole files would lose each other's lines.
 */
export function fileJournal(path: string): Journal {
  return {
    async record(entry) {
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, `${JSON.stringify(entry)}\n`, 'utf8');
    },
    async all() {
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch {
        return [];
      }

      const entries: DelegationRecord[] = [];
      for (const line of text.split(/\r?\n/)) {
        if (line.trim() === '') continue;
        try {
          entries.push(JSON.parse(line) as DelegationRecord);
        } catch {
          // A half written line from a process that was killed. Skip it.
        }
      }
      return entries;
    },
  };
}

function seconds(ms: number): string {
  return `${Math.round(ms / 1000)}s`;
}

/** One line per delegation, for the sweep log and for a person reading it. */
export function describeDelegation(record: DelegationRecord): string {
  return [
    record.at,
    record.agent.padEnd(10),
    record.label.padEnd(28),
    record.timedOut ? 'timed out' : record.ok ? 'ok' : 'failed',
    seconds(record.durationMs),
    record.costUsd === undefined ? '' : `$${record.costUsd.toFixed(2)}`,
    record.ok || record.error === undefined ? '' : record.error,
  ]
    .filter((part) => part !== '')
    .join('  ');
}

export function describeFlag(flag: TimeoutFlag): string {
  return [
    `FLAG: ${flag.agent} has timed out ${flag.count} times in a row`,
    `(${flag.labels.join(', ')}).`,
    'Running it again will spend the same time and the same money to find',
    'that out a third time. Read the last log before the next sweep.',
  ].join(' ');
}

/**
 * Which agents have timed out on their last few delegations, every one of
 * them. Reads the journal rather than this process, so an agent that timed
 * out in yesterday's sweep and again in today's is still caught.
 */
export function repeatedTimeouts(
  entries: readonly DelegationRecord[],
  strikes: number = TIMEOUT_STRIKES,
): TimeoutFlag[] {
  const byAgent = new Map<string, DelegationRecord[]>();
  for (const entry of entries) {
    const seen = byAgent.get(entry.agent) ?? [];
    seen.push(entry);
    byAgent.set(entry.agent, seen);
  }

  const flags: TimeoutFlag[] = [];
  for (const [agent, seen] of byAgent) {
    const recent = seen.slice(-strikes);
    if (recent.length < strikes) continue;
    if (!recent.every((entry) => entry.timedOut)) continue;
    flags.push({
      agent,
      count: strikes,
      labels: recent.map((entry) => entry.label),
    });
  }
  return flags;
}

export interface WatchDeps {
  readonly journal: Journal;
  /** Where the per delegation line goes. Standard out, unless a test says so. */
  readonly onLine?: (line: string) => void;
  readonly now?: () => Date;
  readonly strikes?: number;
}

export type WatchedRunner = Delegator & {
  /** Agents that timed out repeatedly during or before this run. */
  readonly flags: readonly TimeoutFlag[];
};

/**
 * Wrap a runner so every delegation leaves a record behind.
 *
 * The wrapper does not stop an agent that keeps timing out. Deciding to stop
 * spending on it is a person's call, and a crew that quietly refuses to run a
 * stage looks exactly like a crew where nothing is wrong. So it flags it,
 * loudly, in the log and in the sweep's own report.
 */
export function watch(runner: Delegator, deps: WatchDeps): WatchedRunner {
  const flags: TimeoutFlag[] = [];
  const now = deps.now ?? (() => new Date());
  const line = deps.onLine ?? ((text: string) => console.log(text));
  const strikes = deps.strikes ?? TIMEOUT_STRIKES;

  return {
    flags,
    async delegate(options) {
      const result = await runner.delegate(options);
      const agent = agentOf(options);

      const record: DelegationRecord = {
        at: now().toISOString(),
        agent,
        label: result.label,
        ok: result.ok,
        timedOut: result.timedOut,
        durationMs: result.durationMs,
        costUsd: result.costUsd,
        logPath: result.logPath,
        error: result.error,
      };

      await deps.journal.record(record);
      line(describeDelegation(record));

      if (result.timedOut) {
        const flag = repeatedTimeouts(await deps.journal.all(), strikes).find(
          (entry) => entry.agent === agent,
        );
        if (flag !== undefined) {
          flags.push(flag);
          line(describeFlag(flag));
        }
      }

      return result;
    },
  };
}
