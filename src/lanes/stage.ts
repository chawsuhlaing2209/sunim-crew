import type { ComponentRow } from '../airtable/index.js';
import type { Config } from '../config/index.js';
import type { DelegateOptions } from '../runner/index.js';
import { readBrief } from './briefs.js';
import { branchFor, workerEnv, workerRun } from './implementation.js';
import type { BlockedReport, LaneRun, RunnerPort } from './implementation.js';

/**
 * The line DevOps ends its report with. A person reads it as a sentence and
 * the manager reads it as an answer, so there is no guessing at prose. The
 * brief tells the worker to write exactly one of these.
 */
export const STAGE_RESULTS = {
  staged: 'staged',
  component: 'blocked by the component',
  pipeline: 'blocked by the pipeline',
} as const;

export type StageResult = (typeof STAGE_RESULTS)[keyof typeof STAGE_RESULTS];

const RESULT_LINE = /^\s*Result:\s*(.+?)\s*$/gim;

/** The last Result line wins, in case the worker thought aloud on the way. */
export function parseStageResult(report: string): StageResult | undefined {
  const found = [...report.matchAll(RESULT_LINE)]
    .map((match) => match[1]?.trim().toLowerCase().replace(/\.$/, ''))
    .filter((value): value is string => value !== undefined);

  const last = found[found.length - 1];
  if (last === undefined) return undefined;

  return Object.values(STAGE_RESULTS).find((result) => result === last);
}

export const STAGE_TOOLS: readonly string[] = [
  'Read',
  'Glob',
  'Grep',
  // Enough to resolve a mechanical conflict and get the branch up.
  'Edit',
  'Bash(git status *)',
  'Bash(git diff *)',
  'Bash(git log *)',
  'Bash(git fetch *)',
  'Bash(git switch *)',
  'Bash(git checkout *)',
  'Bash(git merge *)',
  'Bash(git rebase *)',
  'Bash(git add *)',
  'Bash(git commit *)',
  'Bash(git push *)',
  // Pull requests, through the operator's own gh login.
  'Bash(gh pr *)',
  'Bash(gh run *)',
  'Bash(gh workflow *)',
  'Bash(npm ci)',
  'Bash(npm run *)',
  'Bash(npx *)',
];

/** 30 minutes. A build and a deploy, not a component. */
export const STAGE_TIMEOUT_MS = 30 * 60 * 1000;

export interface StageTaskInput {
  readonly component: ComponentRow;
  readonly config: Config;
  readonly branch: string;
}

export function stageTask(input: StageTaskInput): string {
  const { component, config, branch } = input;
  const { stagingBranch, mainBranch, stageCommand } = config.repo;

  return [
    `Put the ${component.name} branch on staging.`,
    '',
    `Branch: ${branch}`,
    `Base:   ${stagingBranch}. Never ${mainBranch}. A component reaches`,
    `        ${mainBranch} only from ${stagingBranch}, after it has been tested.`,
    '',
    'Then, in order:',
    `1. Open a pull request from ${branch} into ${stagingBranch}.`,
    `   Open the pull request. Do not merge it, and never push straight to`,
    `   ${stagingBranch} or ${mainBranch}. Pushing a fix belongs on ${branch}.`,
    '2. If it will not merge cleanly, resolve only the mechanical conflicts:',
    '   a lockfile, an import order, a generated file. If resolving means',
    '   deciding what the component should look like, stop and report it.',
    stageCommand === undefined
      ? '3. Deploy to staging. This repo has no deploy command in config, so\n   read its package.json scripts and its CI config to find how staging\n   is built and deployed. If it has no such path, stop and report that.'
      : `3. Deploy to staging with: ${stageCommand}`,
    `4. Open the deployed preview and find ${component.name} in it. A build`,
    '   that succeeded is not the same as a page that loads.',
    '',
    'Finish with a report as your last message. Start it with these two',
    'lines, each label first, so nobody has to guess which link is which:',
    '',
    `  Staging: <the link to ${component.name} on staging, exactly as it is>`,
    '  Pull request: <the pull request URL>',
    '',
    'Then, in prose:',
    '  - Whether you resolved a conflict, and which files.',
    '  - The build duration, and any warning worth a second look.',
    '',
    'End with exactly one of these lines, on its own:',
    `  Result: ${STAGE_RESULTS.staged}`,
    `  Result: ${STAGE_RESULTS.component}`,
    `  Result: ${STAGE_RESULTS.pipeline}`,
    '',
    `Use "${STAGE_RESULTS.component}" when the build broke on something in the`,
    'component itself: a type error in it, a missing token, a broken import.',
    'Do not fix it. Say what broke, with the error text and the file, and',
    'somebody opens a fix task for the person who built it.',
    '',
    `Use "${STAGE_RESULTS.pipeline}" when the failure is not the component's:`,
    'a flaky dependency, an expired cache, a runner that died. Retry once',
    'first. If it fails the same way twice, report it and stop.',
    '',
    'Somebody opens your staging link and checks it answers before anything',
    'moves. Wait for the deploy to finish, check it yourself, then report it.',
  ].join('\n');
}

export function stageDelegation(
  input: StageTaskInput & { readonly brief: string; readonly runDir?: string },
): DelegateOptions {
  const { component, config, brief, runDir } = input;

  return {
    label: `${component.name}-stage`,
    agent: 'DevOps',
    brief,
    task: stageTask(input),
    cwd: config.repo.pathOrUrl,
    allowedTools: STAGE_TOOLS,
    ...workerRun(config, STAGE_TIMEOUT_MS),
    // gh reads the operator's own login from their home directory, which is
    // already passed through. The crew stores nobody's GitHub password, and
    // this worker holds no publish key.
    allowEnv: workerEnv(config, [
      'GH_HOST',
      'GIT_AUTHOR_NAME',
      'GIT_AUTHOR_EMAIL',
    ]),
    ...(runDir === undefined ? {} : { runDir }),
  };
}

export interface StageDeps {
  readonly config: Config;
  readonly runner: RunnerPort;
  readonly loadBrief?: () => Promise<string>;
  readonly runDir?: string;
}

/**
 * Run DevOps on one component. It opens the pull request, gets the branch onto
 * staging, and reports the link. It writes nothing: whether the link is real
 * is the manager's to check, and whether a failure becomes a fix task is the
 * manager's to decide.
 */
export async function runStage(
  component: ComponentRow,
  deps: StageDeps,
): Promise<LaneRun> {
  if (component.commit === undefined) {
    return {
      ok: false,
      report: '',
      note: `${component.name} has no commit recorded, so there is no branch to stage`,
      logPath: undefined,
      durationMs: 0,
      costUsd: undefined,
    };
  }

  const brief = await (deps.loadBrief ?? (() => readBrief('devops')))();
  const result = await deps.runner.delegate(
    stageDelegation({
      component,
      config: deps.config,
      branch: branchFor(component),
      brief,
      ...(deps.runDir === undefined ? {} : { runDir: deps.runDir }),
    }),
  );

  const report = result.result ?? '';
  const outcome = parseStageResult(report);
  const blocked: BlockedReport | undefined =
    outcome === STAGE_RESULTS.component
      ? { belongsToComponent: true, reason: report.trim() }
      : outcome === STAGE_RESULTS.pipeline
        ? { belongsToComponent: false, reason: report.trim() }
        : undefined;

  const note = !result.ok
    ? `DevOps did not finish: ${result.error ?? 'no result'}`
    : blocked?.belongsToComponent === true
      ? 'DevOps stopped: the component is what broke'
      : blocked !== undefined
        ? 'DevOps stopped: the pipeline broke, not the component'
        : outcome === undefined
          ? 'DevOps finished without saying whether it staged'
          : `DevOps staged it in ${Math.round(result.durationMs / 1000)}s`;

  return {
    // A worker that stopped has not staged anything, whatever its exit code.
    ok: result.ok && blocked === undefined && outcome === STAGE_RESULTS.staged,
    report,
    note,
    logPath: result.logPath,
    durationMs: result.durationMs,
    costUsd: result.costUsd,
    ...(blocked === undefined ? {} : { blocked }),
  };
}
