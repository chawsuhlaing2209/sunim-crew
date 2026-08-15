import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import type { ComponentRow, TestRow } from '../airtable/index.js';
import { loadConfig } from '../config/index.js';
import type { Config } from '../config/index.js';
import { FORBIDDEN_IN_CHILD } from '../runner/index.js';
import type { DelegateOptions, DelegateResult } from '../runner/index.js';
import {
  FIX_TOOLS,
  briefPath,
  fixDelegation,
  issueFromRow,
  runFix,
} from './index.js';
import type { RunnerPort } from './index.js';

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

function component(): ComponentRow {
  return {
    id: 'recButton',
    name: 'Button',
    status: 'To be fixed',
    statusRaw: 'To be fixed',
    figma: undefined,
    design: undefined,
    commit: 'https://github.com/o/r/commit/abc1234',
    storybook: 'https://staging.example.com/sb/',
    stagingUrl: undefined,
    productionUrl: undefined,
    astro: undefined,
    totalTests: 2,
    passedTests: 1,
    synchronization: undefined,
  };
}

function row(overrides: Partial<TestRow> = {}): TestRow {
  return {
    id: 'recCase1',
    name: 'Button, primary, md, disabled',
    result: 'Failed',
    resultRaw: 'Failed',
    expected: 'Background resolves to the disabled surface token',
    suggestion: 'Bind the disabled background to surface-disabled',
    componentIds: ['recButton'],
    attachments: [
      { id: 'att1', url: 'https://x/shot.png', filename: 'shot.png' },
    ],
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
        result: 'Bound the disabled background to surface-disabled.',
        structuredOutput: undefined,
        sessionId: 's1',
        costUsd: 0.1,
        error: undefined,
        ...result,
      } satisfies DelegateResult);
    }),
  };
}

const brief = () => Promise.resolve('# Fix');

describe('issueFromRow', () => {
  it('carries the case name, the expected result and the suggestion', () => {
    expect(issueFromRow(row())).toEqual({
      caseName: 'Button, primary, md, disabled',
      expected: 'Background resolves to the disabled surface token',
      suggestion: 'Bind the disabled background to surface-disabled',
    });
  });
});

describe('the delegation', () => {
  const options = fixDelegation({
    component: component(),
    config,
    issue: issueFromRow(row()),
    branch: 'component/button',
    brief: '# Fix',
  });

  it('says the line, verbatim', () => {
    expect(options.task).toContain('Apply the suggestion, do not re-diagnose.');
  });

  it('carries the case, the expected result and the suggestion, and no more', () => {
    expect(options.task).toContain('Button, primary, md, disabled');
    expect(options.task).toContain('disabled surface token');
    expect(options.task).toContain('surface-disabled');

    // Not the other cases, not the status, not the record.
    expect(options.task).not.toContain('recButton');
    expect(options.task).not.toContain('To be fixed');
    expect(options.task).not.toContain('Passed');
  });

  it('works on the component branch, and pushes nothing else', () => {
    expect(options.task).toContain('component/button');
    expect(options.task).toContain('Never push to staging');
  });

  it('cannot mark anything fixed, and holds no secrets beyond git identity', () => {
    expect(options.task).toContain('You do not mark this case fixed anywhere');
    for (const key of FORBIDDEN_IN_CHILD) {
      expect(options.allowEnv ?? []).not.toContain(key);
    }
  });

  it('has a smaller reach than a build: no Figma, no Chromatic', () => {
    const tools = FIX_TOOLS.join(' ');

    expect(tools).not.toContain('figma');
    expect(tools).not.toContain('chromatic');
    expect(tools).toContain('Bash(npm test *)');
  });
});

describe('the fix brief', () => {
  it('holds the line verbatim', async () => {
    const text = await readFile(briefPath('fix'), 'utf8');

    expect(text).toContain('Apply the suggestion, do not re-diagnose.');
  });
});

describe('runFix', () => {
  it('runs one worker for one case', async () => {
    const runner = fakeRunner();

    const run = await runFix(component(), row(), {
      config,
      runner,
      loadBrief: brief,
    });

    expect(runner.calls).toHaveLength(1);
    expect(run.ok).toBe(true);
    expect(run.note).toContain('fixed "Button, primary, md, disabled"');
  });

  it('will not spawn a worker for a case with no suggestion on it', async () => {
    const runner = fakeRunner();

    const run = await runFix(component(), row({ suggestion: undefined }), {
      config,
      runner,
      loadBrief: brief,
    });

    expect(runner.calls).toHaveLength(0);
    expect(run.ok).toBe(false);
    expect(run.note).toContain('nothing to apply');
  });

  it('reports a fix that did not finish', async () => {
    const runner = fakeRunner({
      ok: false,
      error: 'timed out after 1200000ms',
      result: undefined,
    });

    const run = await runFix(component(), row(), {
      config,
      runner,
      loadBrief: brief,
    });

    expect(run.ok).toBe(false);
    expect(run.note).toContain('did not finish');
  });
});
