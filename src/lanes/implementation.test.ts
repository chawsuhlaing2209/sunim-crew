import { describe, expect, it, vi } from 'vitest';
import type { ComponentRow } from '../airtable/index.js';
import { loadConfig } from '../config/index.js';
import type { Config } from '../config/index.js';
import { FORBIDDEN_IN_CHILD, childEnv } from '../runner/index.js';
import type { DelegateOptions, DelegateResult } from '../runner/index.js';
import {
  IMPLEMENTATION_TOOLS,
  branchFor,
  briefPath,
  figmaMcpConfig,
  figmaSource,
  implementationDelegation,
  isLocalMcp,
  runImplementation,
} from './index.js';
import type { RunnerPort } from './index.js';
import { readFile } from 'node:fs/promises';

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

function component(overrides: Partial<ComponentRow> = {}): ComponentRow {
  return {
    id: 'recButton',
    name: 'Button',
    status: 'To-do',
    statusRaw: 'To-do',
    figma: 'https://figma.com/design/abc/DS?node-id=1-2',
    design: undefined,
    commit: undefined,
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
        result: 'Built it.',
        structuredOutput: undefined,
        sessionId: 's1',
        costUsd: 0.5,
        error: undefined,
        ...result,
      } satisfies DelegateResult);
    }),
  };
}

describe('figmaSource', () => {
  it('takes the Design column when it holds a link', () => {
    expect(
      figmaSource(
        component({ design: 'https://figma.com/design/xyz?node-id=9-9' }),
      ),
    ).toBe('https://figma.com/design/xyz?node-id=9-9');
  });

  it('falls back to the Figma column, which is where this base keeps it', () => {
    // The shipped base has Design as a select, holding a word, not a link.
    expect(figmaSource(component({ design: 'Done' }))).toBe(
      'https://figma.com/design/abc/DS?node-id=1-2',
    );
  });

  it('finds nothing when neither column holds a link', () => {
    expect(
      figmaSource(component({ design: 'Done', figma: undefined })),
    ).toBeUndefined();
  });
});

describe('branchFor', () => {
  it('makes one branch per component', () => {
    expect(branchFor(component())).toBe('component/button');
    expect(branchFor(component({ name: 'Button group' }))).toBe(
      'component/button-group',
    );
    expect(branchFor(component({ name: 'Card / Media' }))).toBe(
      'component/card-media',
    );
  });
});

describe('the Figma MCP config', () => {
  it('names one http server, with the token from the child environment', () => {
    const parsed = JSON.parse(figmaMcpConfig(config)) as {
      mcpServers: Record<string, Record<string, unknown>>;
    };

    expect(Object.keys(parsed.mcpServers)).toEqual(['figma']);
    expect(parsed.mcpServers['figma']?.['type']).toBe('http');
    expect(parsed.mcpServers['figma']?.['url']).toBe(
      'https://mcp.figma.com/mcp',
    );
    // The header Figma actually wants. It refuses the same token in an
    // Authorization Bearer header: "figd_ tokens must be passed via
    // X-Figma-Token header, not Authorization".
    const headers = parsed.mcpServers['figma']?.['headers'] as
      Record<string, string> | undefined;
    expect(headers?.['X-Figma-Token']).toBe('${FIGMA_TOKEN}');
    expect(JSON.stringify(parsed)).not.toContain('Authorization');
    // The literal placeholder, expanded by the child, not the token itself.
    expect(JSON.stringify(parsed)).not.toContain(config.figma.token);
  });

  it('follows config, so a team can point at the local Dev Mode server', () => {
    const local = loadConfig({
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
        FIGMA_MCP_URL: 'http://127.0.0.1:3845/mcp',
      },
    });

    expect(figmaMcpConfig(local)).toContain('http://127.0.0.1:3845/mcp');
    // The desktop app authenticates through the app you are already signed
    // in to. A token sent there is noise, and noise that looks like a
    // credential is the kind that gets logged somewhere.
    expect(figmaMcpConfig(local)).not.toContain('FIGMA_TOKEN');
    expect(isLocalMcp('http://localhost:3845/mcp')).toBe(true);
    expect(isLocalMcp('https://mcp.figma.com/mcp')).toBe(false);
    // Not a hosted address that merely starts the same way.
    expect(isLocalMcp('https://localhost.evil.example.com/mcp')).toBe(false);
  });
});

describe('the delegation', () => {
  const options = implementationDelegation({
    component: component(),
    config,
    designUrl: 'https://figma.com/design/abc/DS?node-id=1-2',
    branch: 'component/button',
    brief: '# Engineer',
  });

  it('runs in the design system repo, on the component branch', () => {
    expect(options.cwd).toBe('/tmp/design-system');
    expect(options.task).toContain('component/button');
    expect(options.task).toContain(
      'https://figma.com/design/abc/DS?node-id=1-2',
    );
  });

  it('lets the engineer read the design and run the craft, and no more', () => {
    const tools = options.allowedTools ?? [];

    expect(tools).toContain('mcp__figma__get_design_context');
    expect(tools).toContain('mcp__figma__get_variable_defs');
    expect(tools).toContain('Bash(git commit *)');
    expect(tools).toContain('Bash(npx chromatic *)');
    // Nothing that could publish or deploy.
    expect(tools.join(' ')).not.toContain('npm publish');
    expect(IMPLEMENTATION_TOOLS).not.toContain('WebFetch');
  });

  it('asks for the design token and the visual test token, and nothing forbidden', () => {
    const allowed = options.allowEnv ?? [];

    expect(allowed).toContain('FIGMA_TOKEN');
    expect(allowed).toContain('CHROMATIC_TOKEN');
    for (const key of FORBIDDEN_IN_CHILD) {
      expect(allowed).not.toContain(key);
    }
  });

  it('builds a child environment with no Airtable and no npm token', () => {
    const env = childEnv(
      {
        PATH: '/usr/bin',
        ANTHROPIC_API_KEY: 'anthropic',
        FIGMA_TOKEN: 'figma',
        CHROMATIC_TOKEN: 'chromatic',
        AIRTABLE_TOKEN: 'airtable',
        NPM_TOKEN: 'npm',
      },
      { allow: options.allowEnv ?? [] },
    );

    expect(env['FIGMA_TOKEN']).toBe('figma');
    expect(env['CHROMATIC_TOKEN']).toBe('chromatic');
    expect(env['AIRTABLE_TOKEN']).toBeUndefined();
    expect(env['NPM_TOKEN']).toBeUndefined();
  });

  it('asks for no visual check when no service is configured', () => {
    // A worker told to run a command whose credential nobody set fails at
    // that step every single time, and says nothing about the component.
    expect(options.task).not.toContain('npx chromatic');
    expect(options.task).toContain('No visual test service is configured');
    // The numbering closes up rather than skipping a step.
    expect(options.task).toContain(`5. Commit on component/button`);
  });

  it('asks for it again the moment a token is set, with no code change', () => {
    const withVisual = implementationDelegation({
      component: component(),
      config: loadConfig({
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
          CHROMATIC_TOKEN: 'a-real-project-token',
        },
      }),
      designUrl: 'https://figma.com/design/abc/DS?node-id=1-2',
      branch: 'component/button',
      brief: '# Engineer',
    });

    expect(withVisual.task).toContain('5. npx chromatic');
    expect(withVisual.task).toContain('6. Commit on component/button');
    expect(withVisual.task).not.toContain('No visual test service');
  });

  it('tells the engineer the commit has to be pushed to count', () => {
    expect(options.task).toContain('commit you did not push will not count');
  });

  it('confines the push to the component branch', () => {
    expect(options.task).toContain('Never push to staging');
    expect(options.task).toContain('A component branch ships nothing');
  });

  it('says nothing about status, and hands over no record id', () => {
    const whole = `${options.task}\n${options.brief}`;

    expect(whole).not.toContain('recButton');
    expect(whole).not.toContain('Airtable');
    expect(whole.toLowerCase()).not.toContain('to be staged');
  });
});

describe('the engineer brief', () => {
  it('exists where the lane looks for it', async () => {
    const text = await readFile(briefPath('engineer'), 'utf8');

    expect(text).toContain('# Engineer');
    expect(text).toContain('one component');
  });
});

describe('runImplementation', () => {
  it('spawns one process and hands back what the worker said', async () => {
    const runner = fakeRunner({
      result: 'Built Button. Commit https://github.com/o/r/commit/abc1234',
    });

    const run = await runImplementation(component(), {
      config,
      runner,
      loadBrief: () => Promise.resolve('# Engineer'),
    });

    expect(runner.calls).toHaveLength(1);
    expect(run.ok).toBe(true);
    expect(run.report).toContain('commit/abc1234');
    expect(run.note).toContain('engineer finished');
  });

  it('does not spawn anything when there is no design to build from', async () => {
    const runner = fakeRunner();

    const run = await runImplementation(
      component({ design: 'Done', figma: undefined }),
      { config, runner, loadBrief: () => Promise.resolve('# Engineer') },
    );

    expect(runner.calls).toHaveLength(0);
    expect(run.ok).toBe(false);
    expect(run.note).toContain('no design link');
  });

  it('reports a worker that timed out, rather than an empty success', async () => {
    const runner = fakeRunner({
      ok: false,
      timedOut: true,
      result: undefined,
      error: 'timed out after 2700000ms',
    });

    const run = await runImplementation(component(), {
      config,
      runner,
      loadBrief: () => Promise.resolve('# Engineer'),
    });

    expect(run.ok).toBe(false);
    expect(run.note).toContain('timed out');
  });
});
