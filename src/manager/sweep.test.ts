import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AirtableClient,
  ComponentRow,
  DevelopmentStatus,
  TestRow,
} from '../airtable/index.js';
import type { AsanaClient, Subtask } from '../asana/index.js';
import { loadConfig } from '../config/index.js';
import type { Config } from '../config/index.js';
import { fail, inconclusive, pass } from '../verify/index.js';
import { describeSweep, sweep } from './index.js';
import type { VerifyPort } from './index.js';

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
    ASANA_AGENT_QA: 'qa@example.com',
    ASANA_AGENT_DEVOPS: 'devops@example.com',
  },
});

interface Fields {
  figma?: string;
  commit?: string;
  storybook?: string;
  productionUrl?: string;
  astro?: string;
}

/**
 * The Development formula, as docs/crew.md defines it. The fake base derives
 * status from evidence exactly like the real one, so "the status stays put"
 * is a real assertion rather than a restatement of the setup.
 */
function derive(fields: Fields, rows: TestRow[]): DevelopmentStatus {
  if (fields.productionUrl !== undefined && fields.astro !== undefined) {
    return 'Completed';
  }
  if (rows.length > 0) {
    if (rows.some((row) => row.result === 'Failed')) return 'To be fixed';
    if (rows.every((row) => row.result === 'Fixed (To re-test)'))
      return 'Fixed';
    if (rows.some((row) => row.result === 'Fixed (To re-test)'))
      return 'Fixing';
    if (rows.every((row) => row.result === 'Passed')) return 'To be deployed';
  }
  if (fields.storybook !== undefined) return 'Ready for Testing';
  if (fields.commit !== undefined) return 'To be staged';
  return 'To-do';
}

function fakeAirtable(
  initial: Fields = { figma: 'https://figma.com/file/abc' },
  rows: TestRow[] = [],
): AirtableClient & { fields: Fields } {
  const fields: Fields = { ...initial };

  const row = (): ComponentRow => ({
    id: 'recButton',
    name: 'Button',
    status: derive(fields, rows),
    statusRaw: derive(fields, rows),
    figma: fields.figma,
    design: undefined,
    commit: fields.commit,
    storybook: fields.storybook,
    stagingUrl: undefined,
    productionUrl: fields.productionUrl,
    astro: fields.astro,
    totalTests: rows.length,
    passedTests: rows.filter((entry) => entry.result === 'Passed').length,
    synchronization: undefined,
  });

  const client = {
    schema: { tables: { components: { id: 'tblComponents' } } },
    listComponents: () => Promise.resolve([row()]),
    getComponent: () => Promise.resolve(row()),
    listTestRows: () => Promise.resolve(rows),
    writeEvidence: vi.fn((_id: string, patch: Record<string, string>) => {
      Object.assign(fields, patch);
      return Promise.resolve(row());
    }),
  } as unknown as AirtableClient & { fields: Fields };

  Object.defineProperty(client, 'fields', { get: () => fields });
  return client;
}

interface AsanaState {
  completed: boolean;
  comments: string[];
  assignee: string | undefined;
  report: string;
}

function fakeAsana(
  subtask: Partial<Subtask> = {},
): AsanaClient & { state: AsanaState } {
  const state: AsanaState = {
    completed: subtask.completed ?? false,
    comments: [],
    assignee: subtask.assignee?.gid,
    report: '',
  };

  const current = (): Subtask => ({
    gid: 'sub-1',
    parentGid: 'task-1',
    name: subtask.name ?? 'Implementation',
    stage: subtask.stage ?? 'Implementation',
    completed: state.completed,
    assignee:
      state.assignee === undefined
        ? undefined
        : { gid: state.assignee, name: state.assignee },
    notes: 'Done when: ...',
    permalinkUrl: undefined,
  });

  const client = {
    ensureComponentTask: () =>
      Promise.resolve({
        gid: 'task-1',
        name: 'Button',
        key: { component: 'Button', recordId: 'recButton' },
        completed: false,
        permalinkUrl: undefined,
      }),
    listSubtasks: () =>
      Promise.resolve(
        subtask.name === undefined &&
          !state.completed &&
          state.assignee === undefined
          ? []
          : [current()],
      ),
    ensureSubtask: vi.fn(
      (_task: string, _stage: string, options?: { assignee?: string }) => {
        if (state.assignee === undefined && options?.assignee !== undefined) {
          state.assignee = options.assignee;
        }
        return Promise.resolve(current());
      },
    ),
    readResult: () =>
      Promise.resolve(
        state.report === ''
          ? undefined
          : {
              text: state.report,
              source: 'comment' as const,
              authorGid: 'u1',
              authorName: 'Engineer',
              createdAt: undefined,
            },
      ),
    reportOnSubtask: vi.fn((_gid: string, text: string) => {
      state.comments.push(text);
      return Promise.resolve();
    }),
    reopenSubtask: vi.fn(() => {
      state.completed = false;
      return Promise.resolve(current());
    }),
    completeSubtask: () => Promise.resolve(current()),
  } as unknown as AsanaClient & { state: AsanaState };

  Object.defineProperty(client, 'state', { get: () => state });
  return client;
}

function port(overrides: Partial<VerifyPort> = {}): VerifyPort {
  return {
    commitResolves: () => Promise.resolve(pass('resolves')),
    linkLives: () => Promise.resolve(pass('200')),
    testRowsReal: () => Promise.resolve(pass('rows are real')),
    docsPageComplete: () => Promise.resolve(pass('complete')),
    ...overrides,
  };
}

/** A worker that finished its subtask and reported this. */
function workerReported(
  asana: ReturnType<typeof fakeAsana>,
  text: string,
): void {
  asana.state.completed = true;
  asana.state.report = text;
}

const REAL_COMMIT =
  'https://github.com/owner/design-system/commit/abc1234def5678901234567890abcdef12345678';

describe('the liar test', () => {
  let airtable: ReturnType<typeof fakeAirtable>;
  let asana: ReturnType<typeof fakeAsana>;

  beforeEach(() => {
    airtable = fakeAirtable();
    asana = fakeAsana({ name: 'Implementation', stage: 'Implementation' });
  });

  it('does not write the Commit field when the commit does not resolve', async () => {
    // A worker marks its subtask done and reports a commit that is not there.
    workerReported(asana, `Built the Button. Commit ${REAL_COMMIT}`);

    const report = await sweep({
      config,
      airtable,
      asana,
      verify: port({
        commitResolves: () =>
          Promise.resolve(
            fail('commit does not resolve, no such commit in the repo', {
              status: 422,
            }),
          ),
      }),
    });

    expect(airtable.writeEvidence).not.toHaveBeenCalled();
    expect(airtable.fields.commit).toBeUndefined();
    expect(report.outcomes[0]?.wrote).toBeUndefined();
  });

  it('leaves the status exactly where it was', async () => {
    workerReported(asana, `Done. ${REAL_COMMIT}`);

    await sweep({
      config,
      airtable,
      asana,
      verify: port({
        commitResolves: () => Promise.resolve(fail('does not resolve')),
      }),
    });

    // Read the base again. The formula derives from evidence, and no evidence
    // landed, so the component has not moved.
    const after = await airtable.listComponents();
    expect(after[0]?.status).toBe('To-do');
  });

  it('flags the component, and says what it saw', async () => {
    workerReported(asana, `Done. ${REAL_COMMIT}`);

    const report = await sweep({
      config,
      airtable,
      asana,
      verify: port({
        commitResolves: () =>
          Promise.resolve(fail('commit does not resolve, GitHub returned 404')),
      }),
    });

    expect(report.flagged).toHaveLength(1);
    expect(report.counts.flagged).toBe(1);

    const outcome = report.flagged[0];
    expect(outcome?.component).toBe('Button');
    expect(outcome?.stage).toBe('Implementation');
    expect(outcome?.note).toContain('does not resolve');
    expect(outcome?.note).toContain(REAL_COMMIT);
    expect(outcome?.evidence?.summary).toContain('404');
  });

  it('tells the worker on its own subtask, and reopens it', async () => {
    workerReported(asana, `Done. ${REAL_COMMIT}`);

    await sweep({
      config,
      airtable,
      asana,
      verify: port({
        commitResolves: () => Promise.resolve(fail('does not resolve')),
      }),
    });

    expect(asana.reopenSubtask).toHaveBeenCalled();
    expect(asana.state.completed).toBe(false);
    expect(asana.state.comments[0]).toContain('the status has not moved');
    expect(asana.state.comments[0]).toContain('does not resolve');
  });

  it('refuses a report with no commit URL in it at all', async () => {
    workerReported(asana, 'All done, looks great.');

    const report = await sweep({
      config,
      airtable,
      asana,
      verify: port(),
    });

    expect(airtable.writeEvidence).not.toHaveBeenCalled();
    expect(report.outcomes[0]?.kind).toBe('unreported');
    expect(asana.state.completed).toBe(false);
  });

  it('refuses a URL that is not a commit, however plausible', async () => {
    workerReported(
      asana,
      'Done: https://github.com/owner/design-system/pull/42',
    );

    const report = await sweep({ config, airtable, asana, verify: port() });

    expect(airtable.writeEvidence).not.toHaveBeenCalled();
    expect(report.outcomes[0]?.kind).toBe('unreported');
  });
});

describe('an honest worker', () => {
  it('gets its evidence written, and the formula moves the component', async () => {
    const airtable = fakeAirtable();
    const asana = fakeAsana({
      name: 'Implementation',
      stage: 'Implementation',
    });
    workerReported(asana, `Built the Button. Commit ${REAL_COMMIT}`);

    const report = await sweep({
      config,
      airtable,
      asana,
      verify: port({
        commitResolves: () =>
          Promise.resolve(
            pass('commit abc1234 resolves in owner/design-system'),
          ),
      }),
    });

    expect(airtable.writeEvidence).toHaveBeenCalledWith('recButton', {
      commit: REAL_COMMIT,
    });
    expect(report.outcomes[0]?.kind).toBe('verified');
    expect(report.outcomes[0]?.wrote).toBe('commit');

    const after = await airtable.listComponents();
    expect(after[0]?.status).toBe('To be staged');
    expect(asana.state.completed).toBe(true);
  });
});

describe('a check that cannot reach a verdict', () => {
  it('writes nothing, and does not hold it against the worker', async () => {
    const airtable = fakeAirtable();
    const asana = fakeAsana({
      name: 'Implementation',
      stage: 'Implementation',
    });
    workerReported(asana, `Done. ${REAL_COMMIT}`);

    const report = await sweep({
      config,
      airtable,
      asana,
      verify: port({
        commitResolves: () =>
          Promise.resolve(inconclusive('could not reach GitHub')),
      }),
    });

    expect(airtable.writeEvidence).not.toHaveBeenCalled();
    expect(report.outcomes[0]?.kind).toBe('unverifiable');
    expect(report.flagged).toHaveLength(0);
    // The subtask is left alone. It may well be finished.
    expect(asana.state.completed).toBe(true);
    expect(asana.reopenSubtask).not.toHaveBeenCalled();
  });
});

describe('sweep', () => {
  it('opens the right subtask for the status, assigned to the right role', async () => {
    const airtable = fakeAirtable();
    const asana = fakeAsana();

    const report = await sweep({ config, airtable, asana, verify: port() });

    expect(asana.ensureSubtask).toHaveBeenCalledWith(
      'task-1',
      'Implementation',
      {
        assignee: 'engineer@example.com',
      },
    );
    expect(report.outcomes[0]?.kind).toBe('assigned');
    expect(report.outcomes[0]?.role).toBe('Engineer');
  });

  it('sends a staged component to DevOps, and checks the link it reports', async () => {
    const airtable = fakeAirtable({
      figma: 'https://figma.com/file/abc',
      commit: REAL_COMMIT,
    });
    const asana = fakeAsana({ name: 'Stage', stage: 'Stage' });
    workerReported(asana, 'Deployed: https://staging.example.com/storybook/');

    const report = await sweep({ config, airtable, asana, verify: port() });

    expect(report.outcomes[0]?.role).toBe('DevOps');
    expect(airtable.writeEvidence).toHaveBeenCalledWith('recButton', {
      storybook: 'https://staging.example.com/storybook/',
    });
    expect((await airtable.listComponents())[0]?.status).toBe(
      'Ready for Testing',
    );
  });

  it('confirms the test rows are real, with nothing to write', async () => {
    const airtable = fakeAirtable({
      figma: 'https://figma.com/file/abc',
      commit: REAL_COMMIT,
      storybook: 'https://staging.example.com/storybook/',
    });
    const asana = fakeAsana({ name: 'Test', stage: 'Test' });
    workerReported(asana, 'Wrote 16 rows, all passed.');

    const report = await sweep({ config, airtable, asana, verify: port() });

    expect(report.outcomes[0]?.kind).toBe('verified');
    expect(report.outcomes[0]?.wrote).toBeUndefined();
    expect(airtable.writeEvidence).not.toHaveBeenCalled();
  });

  it('flags QA that says it tested when the rows are not there', async () => {
    const airtable = fakeAirtable({
      figma: 'https://figma.com/file/abc',
      commit: REAL_COMMIT,
      storybook: 'https://staging.example.com/storybook/',
    });
    const asana = fakeAsana({ name: 'Test', stage: 'Test' });
    workerReported(asana, 'Tested everything, all passed.');

    const report = await sweep({
      config,
      airtable,
      asana,
      verify: port({
        testRowsReal: () =>
          Promise.resolve(fail('no test rows exist for this component')),
      }),
    });

    expect(report.counts.flagged).toBe(1);
    expect(asana.state.completed).toBe(false);
  });

  it('says which later step owns a status it does not handle yet', async () => {
    const airtable = fakeAirtable(
      {
        figma: 'https://figma.com/file/abc',
        commit: REAL_COMMIT,
        storybook: 'https://staging.example.com/storybook/',
      },
      [
        {
          id: 'r1',
          name: 'Button, primary, hover',
          result: 'Failed',
          resultRaw: 'Failed',
          componentIds: ['recButton'],
          attachments: [],
        },
      ],
    );
    const asana = fakeAsana();

    const report = await sweep({ config, airtable, asana, verify: port() });

    expect(report.outcomes[0]?.status).toBe('To be fixed');
    expect(report.outcomes[0]?.kind).toBe('deferred');
    expect(report.outcomes[0]?.note).toContain('step 10');
  });

  it('leaves a completed component alone', async () => {
    const airtable = fakeAirtable({
      figma: 'https://figma.com/file/abc',
      commit: REAL_COMMIT,
      storybook: 'https://staging.example.com/storybook/',
      productionUrl: 'https://example.com/button',
      astro: 'https://docs.example.com/button',
    });
    const asana = fakeAsana();

    const report = await sweep({ config, airtable, asana, verify: port() });

    expect(report.outcomes[0]?.kind).toBe('idle');
    expect(asana.ensureSubtask).not.toHaveBeenCalled();
  });

  it('runs once and stops, reading the board a single time', async () => {
    const airtable = fakeAirtable();
    const list = vi.spyOn(airtable, 'listComponents');
    const asana = fakeAsana();

    await sweep({ config, airtable, asana, verify: port() });

    expect(list).toHaveBeenCalledTimes(1);
  });

  it('describes what it did in one readable block', async () => {
    const airtable = fakeAirtable();
    const asana = fakeAsana();

    const text = describeSweep(
      await sweep({ config, airtable, asana, verify: port() }),
    );

    expect(text).toContain('1 components');
    expect(text).toContain('Button');
  });
});
