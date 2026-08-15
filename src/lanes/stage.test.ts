import { describe, expect, it, vi } from 'vitest';
import type { ComponentRow } from '../airtable/index.js';
import { loadConfig } from '../config/index.js';
import type { Config } from '../config/index.js';
import { FORBIDDEN_IN_CHILD } from '../runner/index.js';
import type { DelegateOptions, DelegateResult } from '../runner/index.js';
import {
  STAGE_RESULTS,
  STAGE_TOOLS,
  parseStageResult,
  runStage,
  stageDelegation,
} from './index.js';
import type { RunnerPort } from './index.js';

const REAL_COMMIT = 'https://github.com/owner/ds/commit/abc1234';

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
      ...extra,
    },
  });
}

const config = makeConfig();

function component(overrides: Partial<ComponentRow> = {}): ComponentRow {
  return {
    id: 'recButton',
    name: 'Button',
    status: 'To be staged',
    statusRaw: 'To be staged',
    figma: 'https://figma.com/design/abc/DS?node-id=1-2',
    design: undefined,
    commit: REAL_COMMIT,
    storybook: undefined,
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
        result: `Deployed. https://staging.example.com/sb/\nResult: staged`,
        structuredOutput: undefined,
        sessionId: 's1',
        costUsd: 0.2,
        error: undefined,
        ...result,
      } satisfies DelegateResult);
    }),
  };
}

const brief = () => Promise.resolve('# DevOps');

describe('parseStageResult', () => {
  it('reads each of the three answers', () => {
    expect(parseStageResult('Result: staged')).toBe(STAGE_RESULTS.staged);
    expect(parseStageResult('Result: blocked by the component')).toBe(
      STAGE_RESULTS.component,
    );
    expect(parseStageResult('Result: blocked by the pipeline')).toBe(
      STAGE_RESULTS.pipeline,
    );
  });

  it('is not fussy about case or a full stop', () => {
    expect(parseStageResult('result:   Staged.')).toBe(STAGE_RESULTS.staged);
  });

  it('takes the last one, in case the worker thought aloud', () => {
    const report = [
      'First I tried the cache.',
      'Result: blocked by the pipeline',
      'Retried, and it went through.',
      'Result: staged',
    ].join('\n');

    expect(parseStageResult(report)).toBe(STAGE_RESULTS.staged);
  });

  it('returns nothing for a report that does not say', () => {
    expect(parseStageResult('All done, looks good!')).toBeUndefined();
    expect(parseStageResult('Result: mostly fine')).toBeUndefined();
  });
});

describe('the delegation', () => {
  const options = stageDelegation({
    component: component(),
    config,
    branch: 'component/button',
    brief: '# DevOps',
  });

  it('opens the pull request into staging, and says never main', () => {
    expect(options.task).toContain('into staging');
    expect(options.task).toContain('Never main');
  });

  it('opens the pull request but never pushes into staging itself', () => {
    expect(options.task).toContain('Do not merge it');
    expect(options.task).toContain('never push straight to');
  });

  it('tells DevOps to find the deploy path when config names no command', () => {
    expect(options.task).toContain('no deploy command in config');
  });

  it('uses the command when config names one', () => {
    const named = stageDelegation({
      component: component(),
      config: makeConfig({ REPO_STAGE_COMMAND: 'npm run deploy:staging' }),
      branch: 'component/button',
      brief: '# DevOps',
    });

    expect(named.task).toContain('npm run deploy:staging');
    expect(named.task).not.toContain('no deploy command in config');
  });

  it('asks for the three answers by name', () => {
    for (const result of Object.values(STAGE_RESULTS)) {
      expect(options.task).toContain(`Result: ${result}`);
    }
  });

  it('can open a pull request but cannot publish or deploy production', () => {
    const tools = (options.allowedTools ?? []).join(' ');

    expect(tools).toContain('Bash(gh pr *)');
    expect(tools).not.toContain('npm publish');
    expect(STAGE_TOOLS).not.toContain('WebFetch');
  });

  it('holds no publish key, and no Airtable', () => {
    for (const key of FORBIDDEN_IN_CHILD) {
      expect(options.allowEnv ?? []).not.toContain(key);
    }
    // gh reads the operator's own login from their home directory.
    expect(options.allowEnv ?? []).not.toContain('GITHUB_TOKEN');
  });
});

describe('runStage', () => {
  it('reports the staging link when the branch went up', async () => {
    const runner = fakeRunner();

    const run = await runStage(component(), {
      config,
      runner,
      loadBrief: brief,
    });

    expect(run.ok).toBe(true);
    expect(run.report).toContain('https://staging.example.com/sb/');
    expect(run.blocked).toBeUndefined();
  });

  it('does not spawn anything before there is a commit to stage', async () => {
    const runner = fakeRunner();

    const run = await runStage(component({ commit: undefined }), {
      config,
      runner,
      loadBrief: brief,
    });

    expect(runner.calls).toHaveLength(0);
    expect(run.ok).toBe(false);
    expect(run.note).toContain('no commit recorded');
  });

  it('marks a component fault as blocked, and keeps what broke', async () => {
    const runner = fakeRunner({
      result: [
        'The build failed on this component.',
        "src/Button.tsx:12 Type error: 'variant' is not assignable.",
        'Result: blocked by the component',
      ].join('\n'),
    });

    const run = await runStage(component(), {
      config,
      runner,
      loadBrief: brief,
    });

    expect(run.ok).toBe(false);
    expect(run.blocked?.belongsToComponent).toBe(true);
    expect(run.blocked?.reason).toContain('src/Button.tsx:12');
    expect(run.note).toContain('the component is what broke');
  });

  it('marks a pipeline fault as blocked, but not the component’s', async () => {
    const runner = fakeRunner({
      result: 'The runner died twice.\nResult: blocked by the pipeline',
    });

    const run = await runStage(component(), {
      config,
      runner,
      loadBrief: brief,
    });

    expect(run.ok).toBe(false);
    expect(run.blocked?.belongsToComponent).toBe(false);
    expect(run.note).toContain('the pipeline broke');
  });

  it('does not call it staged when the worker never said so', async () => {
    const runner = fakeRunner({ result: 'Deployed I think. Looks fine.' });

    const run = await runStage(component(), {
      config,
      runner,
      loadBrief: brief,
    });

    expect(run.ok).toBe(false);
    expect(run.note).toContain('without saying whether it staged');
  });

  it('does not call it staged when the process itself failed', async () => {
    const runner = fakeRunner({
      ok: false,
      error: 'timed out after 1800000ms',
      result: 'Result: staged',
    });

    const run = await runStage(component(), {
      config,
      runner,
      loadBrief: brief,
    });

    expect(run.ok).toBe(false);
    expect(run.note).toContain('did not finish');
  });
});
