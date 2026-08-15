import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentRow } from '../airtable/index.js';
import { loadConfig } from '../config/index.js';
import type { Config } from '../config/index.js';
import { FORBIDDEN_IN_CHILD, childEnv } from '../runner/index.js';
import type { DelegateOptions, DelegateResult } from '../runner/index.js';
import {
  RESULTS_FILENAME,
  prepareCases,
  qaDelegation,
  readResults,
  runQa,
} from './index.js';
import type { QaResults, RunnerPort } from './index.js';

const config: Config = loadConfig({
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

const STAGING = 'https://staging.example.com/storybook/';

function component(overrides: Partial<ComponentRow> = {}): ComponentRow {
  return {
    id: 'recButton',
    name: 'Button',
    status: 'Ready for Testing',
    statusRaw: 'Ready for Testing',
    figma: undefined,
    design: undefined,
    commit: 'https://github.com/o/r/commit/abc1234',
    storybook: STAGING,
    stagingUrl: undefined,
    productionUrl: undefined,
    astro: undefined,
    totalTests: undefined,
    passedTests: undefined,
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
        result: 'Wrote 2 cases, 1 passed, 1 failed.',
        structuredOutput: undefined,
        sessionId: 's1',
        costUsd: 0.3,
        error: undefined,
        ...result,
      } satisfies DelegateResult);
    }),
  };
}

const brief = () => Promise.resolve('# QA');

const GOOD: QaResults = {
  component: 'Button',
  stagingUrl: STAGING,
  cases: [
    {
      name: 'Button, primary, md, hover',
      variant: 'primary',
      size: 'md',
      state: 'hover',
      result: 'Passed',
      screenshot: 'hover.png',
    },
    {
      name: 'Button, primary, md, disabled',
      variant: 'primary',
      size: 'md',
      state: 'disabled',
      result: 'Failed',
      screenshot: 'disabled.png',
      expected: 'Background resolves to the disabled surface token',
      suggestion: 'Bind the disabled background to surface-disabled',
    },
  ],
};

describe('the delegation', () => {
  const options = qaDelegation({
    component: component(),
    config,
    stagingUrl: STAGING,
    resultsDir: '/tmp/results',
    brief: '# QA',
  });

  it('tests against the staging preview, not a local build', () => {
    expect(options.task).toContain(STAGING);
  });

  it('grants the results directory, which is outside the repo', () => {
    expect(options.addDirs).toContain('/tmp/results');
    expect(options.task).toContain(`/tmp/results/${RESULTS_FILENAME}`);
  });

  it('gives QA no secrets at all', () => {
    expect(options.allowEnv).toEqual([]);

    const env = childEnv(
      {
        PATH: '/usr/bin',
        ANTHROPIC_API_KEY: 'anthropic',
        AIRTABLE_TOKEN: 'airtable',
        FIGMA_TOKEN: 'figma',
        NPM_TOKEN: 'npm',
      },
      { allow: options.allowEnv ?? [] },
    );

    // Its own key to run on, and nothing else.
    expect(env['ANTHROPIC_API_KEY']).toBe('anthropic');
    expect(env['FIGMA_TOKEN']).toBeUndefined();
    for (const key of FORBIDDEN_IN_CHILD) {
      expect(env[key]).toBeUndefined();
    }
  });

  it('cannot reach git, so it cannot change what it is testing', () => {
    const tools = (options.allowedTools ?? []).join(' ');

    expect(tools).not.toContain('git');
    expect(tools).not.toContain('Edit');
  });
});

describe('readResults', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sunim-qa-'));
  });

  const write = (body: unknown) =>
    writeFile(
      join(dir, RESULTS_FILENAME),
      typeof body === 'string' ? body : JSON.stringify(body),
      'utf8',
    );

  it('reads a well formed results file', async () => {
    await write(GOOD);
    const read = await readResults(dir);

    expect('results' in read && read.results.cases).toHaveLength(2);
  });

  it('says so when QA wrote no file at all', async () => {
    const read = await readResults(dir);

    expect('error' in read && read.error).toContain('no results file');
  });

  it('refuses a file that is not JSON', async () => {
    await write('not json');
    const read = await readResults(dir);

    expect('error' in read && read.error).toContain('not valid JSON');
  });

  it('refuses an empty run, because that is not a tested component', async () => {
    await write({ component: 'Button', cases: [] });
    const read = await readResults(dir);

    expect('error' in read && read.error).toContain('nothing was tested');
  });

  it('refuses a Failed case with no expected result or suggestion', async () => {
    await write({
      component: 'Button',
      cases: [
        {
          name: 'Button, primary, md, hover',
          result: 'Failed',
          screenshot: 'a.png',
        },
      ],
    });
    const read = await readResults(dir);

    expect('error' in read && read.error).toContain('one suggestion');
  });

  it('refuses a result that is not Passed or Failed', async () => {
    await write({
      component: 'Button',
      cases: [
        {
          name: 'Button, primary',
          result: 'Probably fine',
          screenshot: 'a.png',
        },
      ],
    });
    const read = await readResults(dir);

    expect('error' in read && read.error).toContain('does not validate');
  });

  it('refuses a case with no screenshot named', async () => {
    await write({
      component: 'Button',
      cases: [{ name: 'Button, primary', result: 'Passed' }],
    });
    const read = await readResults(dir);

    expect('error' in read && read.error).toContain('screenshot');
  });
});

describe('prepareCases', () => {
  it('resolves screenshots beside the results file', () => {
    const cases = prepareCases(GOOD, '/tmp/results');

    expect(cases[0]?.screenshotPath).toBe('/tmp/results/hover.png');
  });

  it('carries the expected result and the suggestion onto the row', () => {
    const cases = prepareCases(GOOD, '/tmp/results');

    expect(cases[1]?.row.result).toBe('Failed');
    expect(cases[1]?.row.expected).toContain('disabled surface token');
    expect(cases[1]?.row.suggestion).toContain('surface-disabled');
  });

  it('leaves a passing row without detail it does not need', () => {
    const cases = prepareCases(GOOD, '/tmp/results');

    expect(cases[0]?.row.expected).toBeUndefined();
  });
});

describe('runQa', () => {
  it('hands back the cases QA wrote', async () => {
    const runner = fakeRunner();

    const run = await runQa(component(), {
      config,
      runner,
      resultsDir: '/tmp/results',
      loadBrief: brief,
      read: () => Promise.resolve({ results: GOOD }),
    });

    expect(run.ok).toBe(true);
    expect(run.cases).toHaveLength(2);
    expect(run.note).toContain('1 passed, 1 failed');
  });

  it('does not spawn anything before there is somewhere to test', async () => {
    const runner = fakeRunner();

    const run = await runQa(component({ storybook: undefined }), {
      config,
      runner,
      resultsDir: '/tmp/results',
      loadBrief: brief,
    });

    expect(runner.calls).toHaveLength(0);
    expect(run.note).toContain('no staging link');
  });

  it('refuses a QA run that says it finished but wrote nothing', async () => {
    const runner = fakeRunner({ result: 'Tested everything, all passed!' });

    const run = await runQa(component(), {
      config,
      runner,
      resultsDir: '/tmp/results',
      loadBrief: brief,
      read: () => Promise.resolve({ error: 'QA wrote no results file' }),
    });

    expect(run.ok).toBe(false);
    expect(run.cases).toBeUndefined();
    expect(run.note).toContain('said it finished, but');
  });

  it('reports a QA worker that timed out', async () => {
    const runner = fakeRunner({
      ok: false,
      error: 'timed out after 2400000ms',
      result: undefined,
    });

    const run = await runQa(component(), {
      config,
      runner,
      resultsDir: '/tmp/results',
      loadBrief: brief,
      read: () => Promise.resolve({ results: GOOD }),
    });

    expect(run.ok).toBe(false);
    expect(run.note).toContain('did not finish');
  });
});
