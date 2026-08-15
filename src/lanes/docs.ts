import { join } from 'node:path';
import type { ComponentRow } from '../airtable/index.js';
import type { Config } from '../config/index.js';
import type { DelegateOptions } from '../runner/index.js';
import { REQUIRED_SECTIONS } from '../verify/index.js';
import { readBrief } from './briefs.js';
import { branchFor, workerEnv, workerLimits } from './implementation.js';
import type { LaneRun, RunnerPort } from './implementation.js';

export const DOCS_TOOLS: readonly string[] = [
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'Bash(git status *)',
  'Bash(git diff *)',
  'Bash(git switch *)',
  'Bash(git checkout *)',
  'Bash(git add *)',
  'Bash(git commit *)',
  'Bash(git push *)',
  'Bash(npm run *)',
  'Bash(npx astro *)',
];

/** 30 minutes. Reading a contract and writing eight sections. */
export const DOCS_TIMEOUT_MS = 30 * 60 * 1000;

export function docsSlug(component: ComponentRow): string {
  return component.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Where this component's page will be, once the site is built. */
export function docsUrlFor(
  config: Config,
  component: ComponentRow,
): string | undefined {
  const template = config.docs.urlTemplate;
  return template === undefined
    ? undefined
    : template.replace('{slug}', docsSlug(component));
}

/** Where the page file is written. */
export function docsPageFor(
  config: Config,
  component: ComponentRow,
): string | undefined {
  const path = config.docs.path;
  return path === undefined
    ? undefined
    : join(path, `${docsSlug(component)}.mdx`);
}

export interface DocsTaskInput {
  readonly component: ComponentRow;
  readonly config: Config;
  readonly pagePath: string;
  readonly pageUrl: string;
  readonly branch: string;
}

export function docsTask(input: DocsTaskInput): string {
  const { component, config, pagePath, pageUrl, branch } = input;

  return [
    `Write the documentation page for ${component.name}.`,
    '',
    `Page:   ${pagePath}`,
    `URL:    ${pageUrl}, once the site is built`,
    `Branch: ${branch}. Push that branch and nothing else.`,
    component.productionUrl === undefined
      ? ''
      : `In production at: ${component.productionUrl}`,
    '',
    'Every one of these has to be a heading on the page:',
    ...REQUIRED_SECTIONS.map((section) => `  - ${section.label}`),
    '',
    'Most of it comes from the component contract file in this repo: the',
    'variants, the sizes, the states, the tokens, the accessibility notes and',
    'the usage rule. Read the component source and its stories too, and if the',
    'contract and the code disagree, say so in your report rather than',
    'smoothing it over on the page.',
    '',
    config.docs.deployCommand === undefined
      ? 'Build the docs site the way this repo builds it, and open your page.'
      : `Build and publish the docs site with: ${config.docs.deployCommand}`,
    'A page that builds is not the same as a page that reads. Open it.',
    '',
    'Then commit and push.',
    '',
    'Finish with a report as your last message: the page URL, which sections',
    'you wrote, any you could not fill in, anywhere the contract and the code',
    'disagreed, and whether the site built.',
    '',
    'Somebody checks every section is present. Nobody checks the writing but a',
    'person, at the end, who will read it properly. Write it for them.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export function docsDelegation(
  input: DocsTaskInput & { readonly brief: string; readonly runDir?: string },
): DelegateOptions {
  const { component, config, brief, runDir } = input;

  return {
    label: `${component.name}-document`,
    agent: 'Writer',
    brief,
    task: docsTask(input),
    cwd: config.repo.pathOrUrl,
    allowedTools: DOCS_TOOLS,
    ...workerLimits(config, DOCS_TIMEOUT_MS),
    allowEnv: workerEnv(config, ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL']),
    ...(config.docs.path === undefined ? {} : { addDirs: [config.docs.path] }),
    ...(runDir === undefined ? {} : { runDir }),
  };
}

export interface DocsDeps {
  readonly config: Config;
  readonly runner: RunnerPort;
  readonly loadBrief?: () => Promise<string>;
  readonly runDir?: string;
}

/**
 * Write the page for one shipped component.
 *
 * The writing is delegated rather than done by the manager, because the
 * manager then checks the page. One actor producing the thing and judging it
 * is the arrangement this whole design avoids, and CLAUDE.md is explicit:
 * the manager checks process, never quality. It confirms eight headings are
 * there. A person reads the prose.
 */
export async function runDocs(
  component: ComponentRow,
  deps: DocsDeps,
): Promise<LaneRun> {
  const pagePath = docsPageFor(deps.config, component);
  const pageUrl = docsUrlFor(deps.config, component);

  if (pagePath === undefined || pageUrl === undefined) {
    return {
      ok: false,
      report: '',
      note: `no docs ${pagePath === undefined ? 'path' : 'url template'} in config, so there is nowhere to write the page. Set docs.${pagePath === undefined ? 'path' : 'urlTemplate'}.`,
      logPath: undefined,
      durationMs: 0,
      costUsd: undefined,
    };
  }

  const brief = await (deps.loadBrief ?? (() => readBrief('docs')))();
  const result = await deps.runner.delegate(
    docsDelegation({
      component,
      config: deps.config,
      pagePath,
      pageUrl,
      branch: branchFor(component),
      brief,
      ...(deps.runDir === undefined ? {} : { runDir: deps.runDir }),
    }),
  );

  return {
    ok: result.ok,
    report: result.result ?? '',
    note: result.ok
      ? `wrote the ${component.name} page in ${Math.round(result.durationMs / 1000)}s`
      : `the docs page did not get written: ${result.error ?? 'no result'}`,
    logPath: result.logPath,
    durationMs: result.durationMs,
    costUsd: result.costUsd,
  };
}
