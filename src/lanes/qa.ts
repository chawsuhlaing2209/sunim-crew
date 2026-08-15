import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import type { ComponentRow, NewTestRow } from '../airtable/index.js';
import type { Config } from '../config/index.js';
import type { DelegateOptions } from '../runner/index.js';
import { readBrief } from './briefs.js';
import type { LaneRun, RunnerPort } from './implementation.js';

/**
 * QA hands its results over as a file, not as prose.
 *
 * It cannot write to Airtable, and it should not have to: a worker that could
 * write test rows could write sixteen Passed rows and move the component on
 * its own. So it writes what it saw to disk, the manager reads the file, and
 * the manager puts the rows in the base.
 */
export const caseSchema = z
  .object({
    name: z.string().min(1),
    variant: z.string().min(1).optional(),
    size: z.string().min(1).optional(),
    state: z.string().min(1).optional(),
    result: z.enum(['Passed', 'Failed']),
    /** Beside the results file, or an absolute path. */
    screenshot: z.string().min(1),
    expected: z.string().min(1).optional(),
    suggestion: z.string().min(1).optional(),
  })
  .refine(
    (entry) =>
      entry.result === 'Passed' ||
      (entry.expected !== undefined && entry.suggestion !== undefined),
    {
      message:
        'a Failed case needs what you expected and one suggestion, so the fix does not need re-diagnosing',
    },
  );

export const resultsSchema = z.object({
  component: z.string().min(1),
  stagingUrl: z.string().min(1).optional(),
  cases: z.array(caseSchema).min(1, 'no cases, so nothing was tested'),
});

export type ReportedCase = z.infer<typeof caseSchema>;
export type QaResults = z.infer<typeof resultsSchema>;

/** One case, ready for the base, with the screenshot resolved on disk. */
export interface PreparedCase {
  readonly row: NewTestRow;
  readonly screenshotPath: string;
}

export const RESULTS_FILENAME = 'cases.json';

export const QA_TOOLS: readonly string[] = [
  'Read',
  'Write',
  'Glob',
  'Grep',
  // Whatever the repo uses to drive a browser and take a picture of a story.
  'Bash(npx playwright *)',
  'Bash(npx test-storybook *)',
  'Bash(npm run *)',
  'Bash(mkdir *)',
  'Bash(ls *)',
];

/** 40 minutes. Every variant, size and state, one screenshot each. */
export const QA_TIMEOUT_MS = 40 * 60 * 1000;

export interface QaTaskInput {
  readonly component: ComponentRow;
  readonly stagingUrl: string;
  /** Where the results file and the screenshots go. */
  readonly resultsDir: string;
}

export function qaTask(input: QaTaskInput): string {
  const { component, stagingUrl, resultsDir } = input;
  const resultsPath = join(resultsDir, RESULTS_FILENAME);

  return [
    `Test the ${component.name} component against the built preview.`,
    '',
    `Preview: ${stagingUrl}`,
    `Write your results to: ${resultsPath}`,
    `Put the screenshots in the same directory: ${resultsDir}`,
    '',
    'Then, in order:',
    `1. Read the contract file for ${component.name} in this repo. It lists`,
    '   every variant, every size and every state.',
    '2. Work through every combination of the three. One combination is one',
    '   case. Do not skip one because it looks like another.',
    '3. Open each case in the preview, look at it, and compare it against the',
    '   contract.',
    '4. Take a screenshot of every case, passing or failing.',
    '5. Check the accessible name, the focus order and the contrast on every',
    '   interactive state.',
    '',
    `Write ${RESULTS_FILENAME} as JSON in exactly this shape:`,
    '',
    '{',
    `  "component": "${component.name}",`,
    `  "stagingUrl": "${stagingUrl}",`,
    '  "cases": [',
    '    {',
    `      "name": "${component.name}, primary, md, hover",`,
    '      "variant": "primary",',
    '      "size": "md",',
    '      "state": "hover",',
    '      "result": "Passed",',
    '      "screenshot": "button-primary-md-hover.png"',
    '    },',
    '    {',
    `      "name": "${component.name}, primary, md, disabled",`,
    '      "variant": "primary",',
    '      "size": "md",',
    '      "state": "disabled",',
    '      "result": "Failed",',
    '      "screenshot": "button-primary-md-disabled.png",',
    '      "expected": "Background resolves to the disabled surface token",',
    '      "suggestion": "Bind the disabled background to surface-disabled"',
    '    }',
    '  ]',
    '}',
    '',
    'The result is Passed or Failed, nothing else. If you cannot tell, it is',
    'Failed with a note saying you could not tell. Every Failed case needs',
    'what you expected and one suggestion, specific enough that somebody',
    'applies it without working out the problem again.',
    '',
    'Every case needs a screenshot. A row with no picture on it does not',
    'count, and a run that says everything passed with nothing attached',
    'counts for nothing at all.',
    '',
    'Finish with a short report as your last message: how many cases you',
    'wrote, how many passed and failed, the failed case names, and anything',
    'you could not test.',
  ].join('\n');
}

export function qaDelegation(
  input: QaTaskInput & {
    readonly config: Config;
    readonly brief: string;
    readonly runDir?: string;
  },
): DelegateOptions {
  const { component, config, brief, resultsDir, runDir } = input;

  return {
    label: `${component.name}-test`,
    brief,
    task: qaTask(input),
    cwd: config.repo.pathOrUrl,
    // The results directory is outside the repo, so it has to be granted.
    addDirs: [resultsDir],
    allowedTools: QA_TOOLS,
    timeoutMs: QA_TIMEOUT_MS,
    allowEnv: [],
    ...(runDir === undefined ? {} : { runDir }),
  };
}

/** Read what QA wrote, and refuse anything that is not the agreed shape. */
export async function readResults(
  resultsDir: string,
): Promise<{ results: QaResults } | { error: string }> {
  const path = join(resultsDir, RESULTS_FILENAME);

  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return { error: `QA wrote no results file at ${path}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    return { error: `${RESULTS_FILENAME} is not valid JSON: ${String(error)}` };
  }

  const result = resultsSchema.safeParse(parsed);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`)
      .slice(0, 5);
    return {
      error: `${RESULTS_FILENAME} does not validate: ${problems.join('; ')}`,
    };
  }

  return { results: result.data };
}

export function prepareCases(
  results: QaResults,
  resultsDir: string,
): PreparedCase[] {
  return results.cases.map((entry) => ({
    row: {
      name: entry.name,
      result: entry.result,
      ...(entry.expected === undefined ? {} : { expected: entry.expected }),
      ...(entry.suggestion === undefined
        ? {}
        : { suggestion: entry.suggestion }),
    },
    screenshotPath: isAbsolute(entry.screenshot)
      ? entry.screenshot
      : resolve(resultsDir, entry.screenshot),
  }));
}

export interface QaDeps {
  readonly config: Config;
  readonly runner: RunnerPort;
  /** Where the results file and screenshots are written. */
  readonly resultsDir: string;
  readonly loadBrief?: () => Promise<string>;
  readonly runDir?: string;
  readonly read?: (
    dir: string,
  ) => Promise<{ results: QaResults } | { error: string }>;
}

/**
 * Run QA on one component. It tests against the staging preview and writes
 * what it saw to disk. Nothing reaches the base here: the manager reads the
 * file, writes the rows, and uploads the screenshots, because only the
 * manager holds the token.
 */
export async function runQa(
  component: ComponentRow,
  deps: QaDeps,
): Promise<LaneRun> {
  const stagingUrl = component.storybook ?? component.stagingUrl;

  if (stagingUrl === undefined) {
    return {
      ok: false,
      report: '',
      note: `${component.name} has no staging link, so there is nothing to test against`,
      logPath: undefined,
      durationMs: 0,
      costUsd: undefined,
    };
  }

  const brief = await (deps.loadBrief ?? (() => readBrief('qa')))();
  const result = await deps.runner.delegate(
    qaDelegation({
      component,
      config: deps.config,
      stagingUrl,
      resultsDir: deps.resultsDir,
      brief,
      ...(deps.runDir === undefined ? {} : { runDir: deps.runDir }),
    }),
  );

  const report = result.result ?? '';

  if (!result.ok) {
    return {
      ok: false,
      report,
      note: `QA did not finish: ${result.error ?? 'no result'}`,
      logPath: result.logPath,
      durationMs: result.durationMs,
      costUsd: result.costUsd,
    };
  }

  const read = await (deps.read ?? readResults)(deps.resultsDir);

  if ('error' in read) {
    return {
      ok: false,
      report,
      note: `QA said it finished, but ${read.error}`,
      logPath: result.logPath,
      durationMs: result.durationMs,
      costUsd: result.costUsd,
    };
  }

  const cases = prepareCases(read.results, deps.resultsDir);
  const passed = cases.filter((entry) => entry.row.result === 'Passed').length;

  return {
    ok: true,
    report,
    note: `QA wrote ${cases.length} cases, ${passed} passed, ${cases.length - passed} failed`,
    logPath: result.logPath,
    durationMs: result.durationMs,
    costUsd: result.costUsd,
    cases,
  };
}
