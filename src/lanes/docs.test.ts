import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type { ComponentRow } from '../airtable/index.js';
import { loadConfig } from '../config/index.js';
import type { Config } from '../config/index.js';
import { FORBIDDEN_IN_CHILD } from '../runner/index.js';
import type { DelegateOptions, DelegateResult } from '../runner/index.js';
import { REQUIRED_SECTIONS } from '../verify/index.js';
import {
  briefPath,
  docsDelegation,
  docsPageFor,
  docsSlug,
  docsUrlFor,
  runDocs,
} from './index.js';
import type { RunnerPort } from './index.js';

function makeConfig(extra: Record<string, string> = {}): Config {
  return loadConfig({
    env: {
      ANTHROPIC_API_KEY: 'x',
      GITHUB_TOKEN: 'x',
      AIRTABLE_TOKEN: 'x',
      ASANA_TOKEN: 'x',
      FIGMA_TOKEN: 'x',
      AIRTABLE_BASE_ID: 'appAAAAAAAAAAAAAA',
      ASANA_WORKSPACE_ID: '1',
      ASANA_PROJECT_ID: '2',
      REPO_PATH_OR_URL: '/tmp/design-system',
      DOCS_PATH: '/tmp/design-system/docs/src/content/docs/components',
      DOCS_URL_TEMPLATE: 'https://docs.example.com/components/{slug}',
      ...extra,
    },
  });
}

const config = makeConfig();

function component(overrides: Partial<ComponentRow> = {}): ComponentRow {
  return {
    id: 'recButton',
    name: 'Button group',
    status: 'To be deployed',
    statusRaw: 'To be deployed',
    figma: undefined,
    design: undefined,
    commit: 'https://github.com/o/r/commit/abc1234',
    storybook: 'https://staging.example.com/sb/',
    stagingUrl: undefined,
    productionUrl: 'https://ds.example.com/components/button-group',
    astro: undefined,
    totalTests: 4,
    passedTests: 4,
    synchronization: undefined,
    ...overrides,
  };
}

function fakeRunner(result: Partial<DelegateResult> = {}): RunnerPort & {
  calls: DelegateOptions[];
} {
  const calls: DelegateOptions[] = [];
  return {
    calls,
    delegate: vi.fn((options: DelegateOptions) => {
      calls.push(options);
      return Promise.resolve({
        label: options.label,
        ok: true,
        exitCode: 0,
        signal: null,
        timedOut: false,
        durationMs: 1000,
        promptPath: '/tmp/p.md',
        logPath: '/tmp/p.log',
        result: 'Wrote https://docs.example.com/components/button-group',
        structuredOutput: undefined,
        sessionId: 's1',
        costUsd: 0.2,
        error: undefined,
        ...result,
      } satisfies DelegateResult);
    }),
  };
}

const brief = () => Promise.resolve('# Docs');

describe('where the page goes', () => {
  it('slugs the component into a path and a URL', () => {
    expect(docsSlug(component())).toBe('button-group');
    expect(docsPageFor(config, component())).toBe(
      '/tmp/design-system/docs/src/content/docs/components/button-group.mdx',
    );
    expect(docsUrlFor(config, component())).toBe(
      'https://docs.example.com/components/button-group',
    );
  });
});

describe('the delegation', () => {
  const options = docsDelegation({
    component: component(),
    config,
    pagePath: '/tmp/docs/button-group.mdx',
    pageUrl: 'https://docs.example.com/components/button-group',
    branch: 'component/button-group',
    brief: '# Docs',
  });

  it('names every required section, straight from the contract doc', () => {
    for (const section of REQUIRED_SECTIONS) {
      expect(options.task).toContain(section.label);
    }
  });

  it('points at the page, the URL and the branch', () => {
    expect(options.task).toContain('/tmp/docs/button-group.mdx');
    expect(options.task).toContain('https://docs.example.com/components/');
    expect(options.task).toContain('component/button-group');
  });

  it('tells the writer a person will read the prose', () => {
    expect(options.task).toContain('Nobody checks the writing but a');
  });

  it('holds no publish key', () => {
    for (const key of FORBIDDEN_IN_CHILD) {
      expect(options.allowEnv ?? []).not.toContain(key);
    }
  });
});

describe('the docs brief', () => {
  it('lists all eight sections', async () => {
    const text = await readFile(briefPath('docs'), 'utf8');

    for (const section of REQUIRED_SECTIONS) {
      expect(text).toContain(section.label);
    }
  });

  it('tells the writer not to fix the component from the docs page', async () => {
    const text = await readFile(briefPath('docs'), 'utf8');

    expect(text).toContain('a docs page is not the place to fix a component');
  });
});

describe('runDocs', () => {
  it('runs one worker and hands back what it said', async () => {
    const runner = fakeRunner();

    const run = await runDocs(component(), {
      config,
      runner,
      loadBrief: brief,
    });

    expect(run.ok).toBe(true);
    expect(run.report).toContain('docs.example.com');
  });

  it('will not spawn a worker with nowhere to write the page', async () => {
    const runner = fakeRunner();
    const bare = loadConfig({
      env: {
        ANTHROPIC_API_KEY: 'x',
        GITHUB_TOKEN: 'x',
        AIRTABLE_TOKEN: 'x',
        ASANA_TOKEN: 'x',
        FIGMA_TOKEN: 'x',
        AIRTABLE_BASE_ID: 'appAAAAAAAAAAAAAA',
        ASANA_WORKSPACE_ID: '1',
        ASANA_PROJECT_ID: '2',
        REPO_PATH_OR_URL: '/tmp/design-system',
      },
    });

    const run = await runDocs(component(), {
      config: bare,
      runner,
      loadBrief: brief,
    });

    expect(runner.calls).toHaveLength(0);
    expect(run.note).toContain('docs.path');
  });

  it('reports a writer that did not finish', async () => {
    const runner = fakeRunner({
      ok: false,
      error: 'timed out after 1800000ms',
      result: undefined,
    });

    const run = await runDocs(component(), {
      config,
      runner,
      loadBrief: brief,
    });

    expect(run.ok).toBe(false);
    expect(run.note).toContain('did not get written');
  });
});
