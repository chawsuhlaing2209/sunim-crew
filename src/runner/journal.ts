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

/**
 * Nothing is wrong with the component, and nothing gets better by spawning
 * the next worker. Not signed in, no credit, a key that is not a key.
 */
const NEEDS_A_PERSON =
  /credit balance|not logged in|please run \/login|invalid api key|authentication_error|unauthorized|401|403/i;

/**
 * The same, except time fixes it.
 *
 * A subscription has a window rather than a balance, so a student who runs
 * out is not broken and has nothing to fix. Telling them their key is bad
 * would send them looking for a problem that is not there, and telling them
 * nothing would have them retry into the same wall all afternoon.
 */
const NEEDS_TIME =
  /rate limit|usage limit|limit reached|limit will reset|quota|too many requests|429/i;

export type HaltKind = 'needs-a-person' | 'needs-time';

export interface Halt {
  readonly kind: HaltKind;
  readonly reason: string;
}

/** When the limit lifts, if the worker happened to say. */
export function resetsAt(error: string): string | undefined {
  return /reset[s]?\s+at\s+([^.,;]+)/i.exec(error)?.[1]?.trim();
}

export function haltFor(error: string | undefined): Halt | undefined {
  if (error === undefined) return undefined;
  if (NEEDS_TIME.test(error)) return { kind: 'needs-time', reason: error };
  if (NEEDS_A_PERSON.test(error)) {
    return { kind: 'needs-a-person', reason: error };
  }
  return undefined;
}

/** Kept for callers that only want to know whether to stop. */
export function willRepeat(error: string | undefined): boolean {
  return haltFor(error) !== undefined;
}

export class HaltedError extends Error {
  readonly kind: HaltKind;

  constructor(halt: Halt) {
    const when = resetsAt(halt.reason);

    super(
      halt.kind === 'needs-time'
        ? [
            `Stopping here: ${halt.reason}.`,
            when === undefined
              ? 'Nothing is broken and there is nothing to fix. Run the sweep again once your limit has reset.'
              : `Nothing is broken and there is nothing to fix. Run the sweep again after ${when}.`,
            'Everything already verified stays written, so the next run picks up where this one stopped.',
          ].join(' ')
        : `Not spawning anything else: ${halt.reason}. Every worker after this one would fail the same way, so the rest of this sweep is skipped rather than run up.`,
    );

    this.name = 'HaltedError';
    this.kind = halt.kind;
  }
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
  /** Why nothing more will be spawned this sweep, once something has stopped it. */
  readonly halted: Halt | undefined;
};

/**
 * Wrap a runner so every delegation leaves a record behind.
 *
 * Two different failures, treated two different ways.
 *
 * An agent that keeps timing out is flagged and still run. Deciding to stop
 * spending on it is a person's call, and a crew that quietly refuses to run a
 * stage looks exactly like a crew where nothing is wrong.
 *
 * A worker that could not authenticate or had no credit is different: that
 * says nothing about the component, and the next worker will hit the same
 * wall in the same seven seconds. So the first one of those stops the rest of
 * the sweep spawning at all. It is loud, it names the reason, and it is the
 * gate that stops one broken key becoming one failed task per component.
 */
export function watch(runner: Delegator, deps: WatchDeps): WatchedRunner {
  const flags: TimeoutFlag[] = [];
  const now = deps.now ?? (() => new Date());
  const line = deps.onLine ?? ((text: string) => console.log(text));
  const strikes = deps.strikes ?? TIMEOUT_STRIKES;
  let halted: Halt | undefined;

  return {
    flags,
    get halted() {
      return halted;
    },
    async delegate(options) {
      if (halted !== undefined) throw new HaltedError(halted);

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

      const halt = result.ok ? undefined : haltFor(result.error);
      if (halt !== undefined) {
        halted = halt;
        line(new HaltedError(halt).message);
      }

      return result;
    },
  };
}
