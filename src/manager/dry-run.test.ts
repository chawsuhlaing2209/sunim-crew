import { describe, expect, it, vi } from 'vitest';
import type { AirtableClient, ComponentRow } from '../airtable/index.js';
import type { AsanaClient } from '../asana/index.js';
import { loadConfig } from '../config/index.js';
import type { Config } from '../config/index.js';
import { runImplementation } from '../lanes/index.js';
import { pass } from '../verify/index.js';
import { describeDryRun, dryLog, dryRun, dryRunner } from './dry-run.js';
import { sweep } from './sweep.js';
import type { VerifyPort } from './types.js';

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
    ASANA_AGENT_ENGINEER: 'engineer@example.com',
    NPM_TOKEN: 'a-real-publish-token',
    REPO_PRODUCTION_COMMAND: 'npm run deploy:production',
  },
});

function component(overrides: Partial<ComponentRow> = {}): ComponentRow {
  return {
    id: 'recButton',
    name: 'Button',
    status: 'To-do',
    statusRaw: 'To-do',
    figma: 'https://figma.com/design/abc/Button',
    design: undefined,
    commit: undefined,
    storybook: undefined,
    stagingUrl: undefined,
    productionUrl: undefined,
    astro: undefined,
    totalTests: 0,
    passedTests: 0,
    synchronization: undefined,
    ...overrides,
  };
}

/** A base and a board that would notice being written to. */
function watched(row: ComponentRow = component()) {
  const airtable = {
    schema: { tables: { components: { id: 'tblComponents' } } },
    listComponents: () => Promise.resolve([row]),
    getComponent: () => Promise.resolve(row),
    listTestRows: () => Promise.resolve([]),
    writeEvidence: vi.fn(() => Promise.resolve(row)),
    createTestRows: vi.fn(() => Promise.resolve([])),
    updateTestRow: vi.fn(() => Promise.resolve(undefined)),
    attachToTestRow: vi.fn(() => Promise.resolve()),
  } as unknown as AirtableClient;

  const asana = {
    ensureComponentTask: vi.fn(() =>
      Promise.resolve({
        gid: 'task-1',
        name: row.name,
        key: { component: row.name, recordId: row.id },
        completed: false,
        permalinkUrl: undefined,
      }),
    ),
    findComponentTask: () => Promise.resolve(undefined),
    listSubtasks: () => Promise.resolve([]),
    ensureSubtask: vi.fn(() => Promise.resolve(undefined)),
    ensureFixSubtask: vi.fn(() => Promise.resolve(undefined)),
    ensureLifecycleSubtasks: vi.fn(() => Promise.resolve([])),
    assignSubtask: vi.fn(() => Promise.resolve(undefined)),
    isSubtaskDone: () => Promise.resolve(false),
    readResult: () => Promise.resolve(undefined),
    listComments: () => Promise.resolve([]),
    reportOnSubtask: vi.fn(() => Promise.resolve()),
    completeSubtask: vi.fn(() => Promise.resolve(undefined)),
    reopenSubtask: vi.fn(() => Promise.resolve(undefined)),
  } as unknown as AsanaClient;

  return { airtable, asana };
}

const verify: VerifyPort = {
  commitResolves: () => Promise.resolve(pass('the commit resolves')),
  linkLives: () => Promise.resolve(pass('the link answers')),
  testRowsReal: () => Promise.resolve(pass('the rows are real')),
  docsPageComplete: () => Promise.resolve(pass('every section is there')),
};

describe('a dry run', () => {
  it('reads the board and writes nothing to it', async () => {
    const real = watched();
    const log = dryLog();
    const { deps } = dryRun(
      { config, airtable: real.airtable, asana: real.asana, verify },
      log,
    );

    const report = await sweep(deps);

    expect(report.outcomes).toHaveLength(1);
    expect(real.airtable.writeEvidence).not.toHaveBeenCalled();
    expect(real.asana.ensureComponentTask).not.toHaveBeenCalled();
    expect(real.asana.ensureSubtask).not.toHaveBeenCalled();
    expect(real.asana.reportOnSubtask).not.toHaveBeenCalled();
    expect(log.would.join('\n')).toContain('Asana: open the task for Button');
  });

  it('says what it would have written, field and value', async () => {
    const real = watched();
    const log = dryLog();
    const { deps } = dryRun(
      { config, airtable: real.airtable, asana: real.asana, verify },
      log,
    );

    await deps.airtable.writeEvidence('recButton', {
      commit: 'https://github.com/o/r/commit/abc',
    });

    expect(log.would[0]).toBe(
      'Airtable: write commit = https://github.com/o/r/commit/abc on recButton',
    );
    expect(real.airtable.writeEvidence).not.toHaveBeenCalled();
  });

  it('composes the prompt a worker would have been given, and sends nobody', async () => {
    const log = dryLog();
    const runner = dryRunner((line) => log.would.push(line), log.prompts);

    const run = await runImplementation(component(), {
      config,
      runner,
      loadBrief: () => Promise.resolve('# The engineer'),
    });

    expect(run.ok).toBe(false);
    expect(log.prompts).toHaveLength(1);
    expect(log.prompts[0]?.agent).toBe('Engineer');
    expect(log.prompts[0]?.prompt).toContain('# The engineer');
    expect(log.prompts[0]?.prompt).toContain('Build the Button component.');
    expect(log.prompts[0]?.prompt).toContain(
      'https://figma.com/design/abc/Button',
    );
  });

  it('deploys nothing and publishes nothing, holding a real npm token', async () => {
    const real = watched(
      component({ status: 'To be deployed', commit: 'https://c/1' }),
    );
    const log = dryLog();
    const { deps } = dryRun(
      { config, airtable: real.airtable, asana: real.asana, verify },
      log,
    );

    const result = await deps.releaseRun?.(component());

    expect(result?.ok).toBe(false);
    expect(result?.error).toContain('dry run');
    expect(log.would.join('\n')).toContain('npm run deploy:production');
    // The command is named in the log and never handed to a shell.
    expect(log.would.join('\n')).not.toContain('a-real-publish-token');
  });

  it('reads back as a list of things that did not happen', () => {
    const text = describeDryRun({
      would: ['Airtable: write commit = https://c/1 on recButton'],
      prompts: [
        {
          label: 'Button-implementation',
          agent: 'Engineer',
          cwd: '/tmp/design-system',
          timeoutMs: 1000,
          prompt: 'x',
        },
      ],
    });

    expect(text).toContain('1 thing a real sweep would have done, and did not');
    expect(text).toContain('Button-implementation (Engineer)');
  });
});
