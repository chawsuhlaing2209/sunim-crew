import { join } from 'node:path';
import { connect as airtableConnect } from '../airtable/index.js';
import type { AirtableClient, ComponentRow } from '../airtable/index.js';
import { connect as asanaConnect } from '../asana/index.js';
import type { AsanaClient } from '../asana/index.js';
import type { Config } from '../config/index.js';
import {
  runDocs,
  runFix,
  runImplementation,
  runQa,
  runStage,
} from '../lanes/index.js';
import type { RunnerPort } from '../lanes/index.js';
import { release } from '../release/index.js';
import { delegate, fileJournal, watch } from '../runner/index.js';
import type { Journal, TimeoutFlag } from '../runner/index.js';
import { dryLog, dryRun, dryRunner } from './dry-run.js';
import type { MutableDryRunLog } from './dry-run.js';
import { verifyPort } from './port.js';
import type { SweepDeps } from './sweep.js';

export interface CrewOptions {
  /** Compose everything, write nothing, publish nothing, spawn nobody. */
  readonly dryRun?: boolean;
  /**
   * Wire the lanes, so the crew does the craft itself rather than only
   * opening subtasks for people to pick up. On by default.
   */
  readonly workers?: boolean;
  /** Where prompts, logs and the delegation journal go. */
  readonly runDir?: string;
  /** Where QA writes its results file and its screenshots. */
  readonly resultsDir?: string;
  /** Where the per delegation line goes. Standard out, by default. */
  readonly onLine?: (line: string) => void;
}

export interface Crew {
  readonly deps: SweepDeps;
  /** Present on a dry run: everything it would have done, and did not. */
  readonly log: MutableDryRunLog | undefined;
  /** Agents that timed out twice in a row. Filled in as the sweep runs. */
  readonly flags: readonly TimeoutFlag[];
  readonly journalPath: string;
  readonly runDir: string;
}

/**
 * Put the crew together. One place, and the only place.
 *
 * Everything that reaches outside this process is wired here: the base, the
 * board, the workers, the release. That is what makes a dry run worth
 * trusting, because there is one composition to swap and nothing further down
 * that knows the difference.
 */
export async function crew(
  config: Config,
  options: CrewOptions = {},
): Promise<Crew> {
  const runDir = options.runDir ?? join(process.cwd(), 'logs');
  const resultsDir = options.resultsDir ?? join(runDir, 'qa');
  const journalPath = join(runDir, 'delegations.jsonl');
  const dry = options.dryRun === true;
  const log: MutableDryRunLog | undefined = dry ? dryLog() : undefined;

  const airtable: AirtableClient = await airtableConnect(config);
  const asana: AsanaClient = asanaConnect(config);
  const journal: Journal = fileJournal(journalPath);

  const spawner: RunnerPort =
    log === undefined
      ? { delegate: (delegation) => delegate(delegation) }
      : dryRunner((line) => log.would.push(line), log.prompts);

  // Every delegation goes through the journal, dry or not. A delegation that
  // left no line behind would read like a day the crew did nothing.
  const runner = watch(spawner, {
    journal,
    ...(options.onLine === undefined ? {} : { onLine: options.onLine }),
  });

  const workers = options.workers !== false;

  const lanes = {
    Implementation: (component: ComponentRow) =>
      runImplementation(component, { config, runner, runDir }),
    Stage: (component: ComponentRow) =>
      runStage(component, { config, runner, runDir }),
    Test: (component: ComponentRow) =>
      runQa(component, { config, runner, runDir, resultsDir }),
    Document: (component: ComponentRow) =>
      runDocs(component, { config, runner, runDir }),
  };

  const live: SweepDeps = {
    config,
    airtable,
    asana,
    verify: verifyPort(config, airtable),
    ...(workers
      ? {
          lanes,
          fixLane: (component, row) =>
            runFix(component, row, { config, runner, runDir }),
        }
      : {}),
    releaseRun: (component) => release(component, config),
  };

  const deps = log === undefined ? live : dryRun(live, log).deps;

  return { deps, log, flags: runner.flags, journalPath, runDir };
}
