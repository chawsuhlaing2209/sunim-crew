import type { ComponentRow, TestRow } from '../airtable/index.js';
import type { FixIssue } from '../asana/index.js';
import type { Config } from '../config/index.js';
import type { DelegateOptions } from '../runner/index.js';
import { readBrief } from './briefs.js';
import { branchFor, workerEnv, workerLimits } from './implementation.js';
import type { LaneRun, RunnerPort } from './implementation.js';

/**
 * A fix is a smaller job than a build, and the tools say so: no Figma, no
 * Chromatic, no Storybook build. Read the code the suggestion points at,
 * change it, run the tests, commit.
 */
export const FIX_TOOLS: readonly string[] = [
  'Read',
  'Edit',
  'Glob',
  'Grep',
  'Bash(git status *)',
  'Bash(git diff *)',
  'Bash(git log *)',
  'Bash(git switch *)',
  'Bash(git checkout *)',
  'Bash(git add *)',
  'Bash(git commit *)',
  'Bash(git push *)',
  'Bash(npm test *)',
  'Bash(npx vitest *)',
];

/** 20 minutes. One case, one change. */
export const FIX_TIMEOUT_MS = 20 * 60 * 1000;

/** What a failed row hands to a Fix subtask. Nothing else travels. */
export function issueFromRow(row: TestRow): FixIssue {
  return {
    caseName: row.name,
    expected: row.expected ?? 'not recorded',
    suggestion: row.suggestion ?? 'not recorded',
  };
}

export interface FixTaskInput {
  readonly component: ComponentRow;
  readonly config: Config;
  readonly issue: FixIssue;
  readonly branch: string;
}

export function fixTask(input: FixTaskInput): string {
  const { config, issue, branch } = input;

  return [
    'Fix one failed test case.',
    '',
    `Case:       ${issue.caseName}`,
    `Expected:   ${issue.expected}`,
    `Suggestion: ${issue.suggestion}`,
    '',
    `Branch: ${branch}, the one this component was built on. Push that branch`,
    `and nothing else. Never push to ${config.repo.stagingBranch} or`,
    `${config.repo.mainBranch}.`,
    '',
    'Apply the suggestion, do not re-diagnose.',
    '',
    'Somebody already opened this case, looked at it, and worked out what is',
    'wrong. Make that change, run the unit tests, commit, push. Do not fix',
    'anything else you notice on the way.',
    '',
    'If the suggestion cannot be applied, because it names something that is',
    'not there or would break another case, say so and change nothing. That',
    'is worth one honest message. A fix that quietly does something else',
    'costs a whole round, because the retest checks against the wrong thing.',
    '',
    'Finish with a report as your last message: the case name exactly as it',
    'was given to you, what you changed and where, the commit URL, and',
    'whether the unit tests pass.',
    '',
    'You do not mark this case fixed anywhere. You report, and somebody else',
    'records it.',
  ].join('\n');
}

export function fixDelegation(
  input: FixTaskInput & { readonly brief: string; readonly runDir?: string },
): DelegateOptions {
  const { component, config, issue, brief, runDir } = input;

  return {
    label: `${component.name}-fix-${issue.caseName}`,
    agent: 'Engineer',
    brief,
    task: fixTask(input),
    cwd: config.repo.pathOrUrl,
    allowedTools: FIX_TOOLS,
    ...workerLimits(config, FIX_TIMEOUT_MS),
    allowEnv: workerEnv(config, ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL']),
    ...(runDir === undefined ? {} : { runDir }),
  };
}

export interface FixDeps {
  readonly config: Config;
  readonly runner: RunnerPort;
  readonly loadBrief?: () => Promise<string>;
  readonly runDir?: string;
}

/**
 * Run the engineer on one failed case. It changes the code and reports. It
 * does not mark the row: a worker that could mark its own case fixed could
 * mark every case fixed, and the retest would be checking nothing.
 */
export async function runFix(
  component: ComponentRow,
  row: TestRow,
  deps: FixDeps,
): Promise<LaneRun> {
  if (row.suggestion === undefined || row.expected === undefined) {
    return {
      ok: false,
      report: '',
      note: `"${row.name}" has no ${row.expected === undefined ? 'expected result' : 'suggestion'} on it, so there is nothing to apply. QA has to fill it in before this can be fixed.`,
      logPath: undefined,
      durationMs: 0,
      costUsd: undefined,
    };
  }

  const brief = await (deps.loadBrief ?? (() => readBrief('fix')))();
  const result = await deps.runner.delegate(
    fixDelegation({
      component,
      config: deps.config,
      issue: issueFromRow(row),
      branch: branchFor(component),
      brief,
      ...(deps.runDir === undefined ? {} : { runDir: deps.runDir }),
    }),
  );

  return {
    ok: result.ok,
    report: result.result ?? '',
    note: result.ok
      ? `fixed "${row.name}" in ${Math.round(result.durationMs / 1000)}s`
      : `the fix for "${row.name}" did not finish: ${result.error ?? 'no result'}`,
    logPath: result.logPath,
    durationMs: result.durationMs,
    costUsd: result.costUsd,
  };
}
