import type { ComponentRow } from '../airtable/index.js';
import type { Config } from '../config/index.js';
import type { DelegateOptions, DelegateResult } from '../runner/index.js';
import { readBrief } from './briefs.js';
import type { PreparedCase } from './qa.js';

/** The runner, as a seam. Tests hand the lane a fake and spawn nothing. */
export interface RunnerPort {
  delegate(options: DelegateOptions): Promise<DelegateResult>;
}

/**
 * A worker saying the work cannot go on, and whose problem it is. A component
 * that will not build is the engineer's to fix, and the manager opens a Fix
 * subtask. A flaky runner is nobody's fault and is simply retried next sweep.
 */
export interface BlockedReport {
  readonly belongsToComponent: boolean;
  readonly reason: string;
}

export interface LaneRun {
  readonly ok: boolean;
  /** What the worker said, to be posted into its subtask. */
  readonly report: string;
  readonly note: string;
  readonly logPath: string | undefined;
  readonly durationMs: number;
  readonly costUsd: number | undefined;
  /** Set when the worker stopped because something is in the way. */
  readonly blocked?: BlockedReport;
  /**
   * Rows a worker produced but cannot write itself. QA is the only lane that
   * makes these: it has no Airtable access, so the manager writes them.
   */
  readonly cases?: readonly PreparedCase[];
}

/**
 * The commands the engineer is allowed to run. Kept in one place: a repo whose
 * scripts are named differently changes this, not the brief.
 */
export const IMPLEMENTATION_COMMANDS = {
  install: 'npm ci',
  test: 'npm test',
  storybook: 'npm run build-storybook',
  chromatic: 'npx chromatic',
} as const;

export const IMPLEMENTATION_TOOLS: readonly string[] = [
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'Bash(git status *)',
  'Bash(git diff *)',
  'Bash(git log *)',
  'Bash(git rev-parse *)',
  'Bash(git switch *)',
  'Bash(git checkout *)',
  'Bash(git add *)',
  'Bash(git commit *)',
  'Bash(git push *)',
  'Bash(npm ci)',
  'Bash(npm install)',
  'Bash(npm test *)',
  'Bash(npm run *)',
  'Bash(npx vitest *)',
  'Bash(npx chromatic *)',
  // The design source, read through the Figma MCP.
  'mcp__figma__get_design_context',
  'mcp__figma__get_variable_defs',
  'mcp__figma__get_screenshot',
  'mcp__figma__get_metadata',
];

/** 45 minutes. A component build with a Storybook build and tests in it. */
export const IMPLEMENTATION_TIMEOUT_MS = 45 * 60 * 1000;

/**
 * Where the design lives for this component.
 *
 * docs/crew.md calls it the Design column, and the shipped base has both a
 * Design column and a Figma column. Whichever one holds a URL is the source;
 * Design wins when both do. A base where Design is a select rather than a link
 * therefore still works, because the Figma column carries the node.
 */
export function figmaSource(component: ComponentRow): string | undefined {
  for (const candidate of [component.design, component.figma]) {
    if (candidate !== undefined && /^https?:\/\/\S+/.test(candidate.trim())) {
      return candidate.trim();
    }
  }
  return undefined;
}

/** One branch per component, off the main branch. */
export function branchFor(component: ComponentRow): string {
  const slug = component.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `component/${slug === '' ? component.id.toLowerCase() : slug}`;
}

/** The Dev Mode server the Figma desktop app runs, on this machine. */
export function isLocalMcp(url: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(url);
}

/**
 * The Figma MCP, defined for the child rather than inherited from the machine.
 * The runner passes --strict-mcp-config, so this is the only server a worker
 * sees, and the credential comes from the child's own environment.
 *
 * Two servers, two arrangements. The desktop app's Dev Mode server runs on
 * this machine and authenticates through the app you are already signed in
 * to, so a token sent to it is noise at best. The hosted one wants a personal
 * access token in X-Figma-Token: it rejects the same token in an
 * Authorization Bearer header, and says so in as many words.
 */
export function figmaMcpConfig(config: Config): string {
  const url = config.figma.mcpUrl;

  return JSON.stringify({
    mcpServers: {
      figma: {
        type: 'http',
        url,
        ...(isLocalMcp(url)
          ? {}
          : { headers: { 'X-Figma-Token': '${FIGMA_TOKEN}' } }),
      },
    },
  });
}

export interface TaskTextInput {
  readonly component: ComponentRow;
  readonly config: Config;
  readonly designUrl: string;
  readonly branch: string;
}

/** What this delegation is about. The brief says how, this says which. */
export function implementationTask(input: TaskTextInput): string {
  const { component, config, designUrl, branch } = input;

  // The visual check is asked for only when a service is configured to run it
  // against. A worker told to run a command whose credential nobody set fails
  // at that step every time, and that failure says nothing about the
  // component. Setting the token is what turns the step back on.
  const visualCheck = config.chromatic.projectToken !== undefined;

  const steps = [
    'Build the component and its stories, every variant, size and state.',
    'Write the contract file beside the component, with every field\n   docs/component-contract.md lists.',
    `${IMPLEMENTATION_COMMANDS.storybook}, and confirm this component's\n   stories are in the built output before you go on.`,
    `${IMPLEMENTATION_COMMANDS.test}. Every test passes.`,
    ...(visualCheck
      ? [`${IMPLEMENTATION_COMMANDS.chromatic}, for the visual check.`]
      : []),
    `Commit on ${branch}, then push ${branch}.\n   Push that branch and nothing else. Never push to ${config.repo.stagingBranch}\n   or ${config.repo.mainBranch}. A component branch ships nothing, which is\n   why pushing it is safe and why it is required.`,
  ].map((step, index) => `${index + 1}. ${step}`);

  return [
    `Build the ${component.name} component.`,
    '',
    `Design source: ${designUrl}`,
    'Read it with the Figma MCP: get_design_context for the structure and the',
    'values, get_variable_defs for the tokens behind them. Take the values from',
    'there. Do not read them off a screenshot, and do not invent one.',
    '',
    `Repo: ${config.repo.pathOrUrl}, which is where you are already running.`,
    `Branch: ${branch}. Create it from ${config.repo.mainBranch} if it is not there.`,
    '',
    'Then, in order:',
    ...steps,
    '',
    ...(visualCheck
      ? []
      : [
          'No visual test service is configured, so there is no visual check to',
          'run and you are not expected to find one. Open the component in the',
          'Storybook you just built and look at it yourself instead.',
          '',
        ]),
    'Finish with a report as your last message. It must contain the full',
    'commit URL, the https://github.com/... form, not a bare sha. Somebody',
    'fetches that URL and checks it resolves before anything moves, so a',
    'commit you did not push will not count.',
    '',
    'Say plainly anything you could not do. A gap you name costs one message.',
    'A gap you paper over costs a whole cycle.',
  ].join('\n');
}

export function implementationDelegation(
  input: TaskTextInput & { readonly brief: string; readonly runDir?: string },
): DelegateOptions {
  const { component, config, brief, runDir } = input;

  return {
    label: `${component.name}-implementation`,
    agent: 'Engineer',
    brief,
    task: implementationTask(input),
    cwd: config.repo.pathOrUrl,
    allowedTools: IMPLEMENTATION_TOOLS,
    mcpConfig: figmaMcpConfig(config),
    timeoutMs: IMPLEMENTATION_TIMEOUT_MS,
    // The design source, and the visual test service. No Airtable, no npm.
    allowEnv: [
      'FIGMA_TOKEN',
      'CHROMATIC_TOKEN',
      'GIT_AUTHOR_NAME',
      'GIT_AUTHOR_EMAIL',
    ],
    ...(runDir === undefined ? {} : { runDir }),
  };
}

export interface ImplementationDeps {
  readonly config: Config;
  readonly runner: RunnerPort;
  readonly loadBrief?: () => Promise<string>;
  readonly runDir?: string;
}

/**
 * Run the engineer on one component. Composes the delegation, spawns one
 * process, and hands back what the worker said. It writes nothing: the manager
 * decides what to do with the report, and only the manager writes evidence.
 */
export async function runImplementation(
  component: ComponentRow,
  deps: ImplementationDeps,
): Promise<LaneRun> {
  const designUrl = figmaSource(component);

  if (designUrl === undefined) {
    return {
      ok: false,
      report: '',
      note: `${component.name} has no design link in the Design or Figma column, so there is nothing to build from`,
      logPath: undefined,
      durationMs: 0,
      costUsd: undefined,
    };
  }

  const brief = await (deps.loadBrief ?? (() => readBrief('engineer')))();
  const result = await deps.runner.delegate(
    implementationDelegation({
      component,
      config: deps.config,
      designUrl,
      branch: branchFor(component),
      brief,
      ...(deps.runDir === undefined ? {} : { runDir: deps.runDir }),
    }),
  );

  return {
    ok: result.ok,
    report: result.result ?? '',
    note: result.ok
      ? `engineer finished in ${Math.round(result.durationMs / 1000)}s`
      : `engineer did not finish: ${result.error ?? 'no result'}`,
    logPath: result.logPath,
    durationMs: result.durationMs,
    costUsd: result.costUsd,
  };
}
