import type {
  AirtableClient,
  ComponentRow,
  TestRow,
  TestRowPatch,
} from '../airtable/index.js';
import { STAGE_DONE_WHEN, fixSubtaskName } from '../asana/index.js';
import type { AsanaClient, ComponentTask, Subtask } from '../asana/index.js';
import type { Config } from '../config/index.js';
import type { RunnerPort } from '../lanes/index.js';
import type { ReleaseResult } from '../release/index.js';
import { composePrompt } from '../runner/index.js';
import type { DelegateOptions, DelegateResult } from '../runner/index.js';
import type { SweepDeps } from './sweep.js';

/**
 * A prompt that was composed and never sent. The whole point of a dry run:
 * the words a worker would have been given, on the page, before anyone spends
 * anything finding out what it does with them.
 */
export interface ComposedPrompt {
  readonly label: string;
  readonly agent: string;
  readonly cwd: string;
  readonly timeoutMs: number | undefined;
  readonly prompt: string;
}

export interface DryRunLog {
  /** Every write, publish and spawn that did not happen, in order. */
  readonly would: readonly string[];
  readonly prompts: readonly ComposedPrompt[];
}

/**
 * The same log while it is still being written. One log for the whole run:
 * the refused writes and the composed prompts happen in one order, and read
 * as one story only if they are kept in one place.
 */
export interface MutableDryRunLog {
  readonly would: string[];
  readonly prompts: ComposedPrompt[];
}

export function dryLog(): MutableDryRunLog {
  return { would: [], prompts: [] };
}

function dryRow(
  id: string,
  componentId: string | undefined,
  patch: TestRowPatch,
): TestRow {
  return {
    id,
    name: patch.name ?? id,
    result: patch.result,
    resultRaw: patch.result,
    expected: patch.expected,
    suggestion: patch.suggestion,
    componentIds: componentId === undefined ? [] : [componentId],
    attachments: [],
  };
}

/**
 * Airtable, readable and inert. Reads go through untouched, because a dry run
 * that cannot see the board cannot tell you what it would do with it.
 */
export function dryAirtable(
  client: AirtableClient,
  note: (line: string) => void,
): AirtableClient {
  return {
    ...client,
    schema: client.schema,
    getComponent: (id) => client.getComponent(id),
    findComponentByName: (name) => client.findComponentByName(name),
    listComponents: () => client.listComponents(),
    listComponentsByStatus: (status) => client.listComponentsByStatus(status),
    listTestRows: (componentId) => client.listTestRows(componentId),

    async writeEvidence(recordId, evidence) {
      const written = Object.entries(evidence)
        .map(([key, value]) => `${key} = ${String(value)}`)
        .join(', ');
      note(`Airtable: write ${written} on ${recordId}`);

      const current = await client.getComponent(recordId);
      if (current === undefined) {
        throw new Error(`no component ${recordId}, even to pretend to write`);
      }
      return current;
    },

    createTestRows(componentId, rows) {
      note(`Airtable: create ${rows.length} test rows on ${componentId}`);
      return Promise.resolve(
        rows.map((row, index) =>
          dryRow(`dry-row-${index}`, componentId, {
            name: row.name,
            result: row.result,
            ...(row.expected === undefined ? {} : { expected: row.expected }),
            ...(row.suggestion === undefined
              ? {}
              : { suggestion: row.suggestion }),
          }),
        ),
      );
    },

    updateTestRow(recordId, patch) {
      note(
        `Airtable: update row ${recordId} to ${patch.result ?? 'unchanged'}`,
      );
      return Promise.resolve(dryRow(recordId, undefined, patch));
    },

    attachToTestRow(rowId, filePath) {
      note(`Airtable: attach ${filePath} to row ${rowId}`);
      return Promise.resolve();
    },
  };
}

function dryTask(gid: string, name: string): ComponentTask {
  return {
    gid,
    name,
    key: { component: name, recordId: gid },
    completed: false,
    permalinkUrl: undefined,
  };
}

function drySubtask(gid: string, name: string): Subtask {
  return {
    gid,
    parentGid: undefined,
    name,
    stage: undefined,
    completed: false,
    assignee: undefined,
    notes: '',
    permalinkUrl: undefined,
  };
}

/**
 * Asana, readable and inert. A task or subtask that is already there is
 * returned as it is; one that is not is invented, so the sweep can carry on
 * and say what it would have done next.
 */
export function dryAsana(
  client: AsanaClient,
  note: (line: string) => void,
): AsanaClient {
  // Gids for tasks and subtasks that do not exist, because the dry run is
  // what stopped them being created. Asana knows nothing about them, so a
  // read against one has to be answered here rather than sent.
  const invented = new Set<string>();

  const listSubtasks = async (taskGid: string): Promise<Subtask[]> =>
    invented.has(taskGid) ? [] : await client.listSubtasks(taskGid);

  return {
    ...client,
    findComponentTask: (key) => client.findComponentTask(key),
    listSubtasks,
    isSubtaskDone: (gid) =>
      invented.has(gid) ? Promise.resolve(false) : client.isSubtaskDone(gid),
    readResult: (gid) =>
      invented.has(gid) ? Promise.resolve(undefined) : client.readResult(gid),
    listComments: (gid) =>
      invented.has(gid) ? Promise.resolve([]) : client.listComments(gid),

    async ensureComponentTask(key) {
      const existing = await client.findComponentTask(key);
      if (existing !== undefined) return existing;
      note(`Asana: open the task for ${key.component}`);
      const gid = `dry-task-${key.recordId}`;
      invented.add(gid);
      return dryTask(gid, key.component);
    },

    async ensureSubtask(taskGid, stage, options) {
      const existing = (await listSubtasks(taskGid)).find(
        (subtask) => subtask.name === stage,
      );
      if (existing !== undefined) return existing;
      note(
        `Asana: open the ${stage} subtask on ${taskGid}${
          options?.assignee === undefined ? '' : `, for ${options.assignee}`
        }, done when: ${STAGE_DONE_WHEN[stage]}`,
      );
      const gid = `dry-${stage}-${taskGid}`;
      invented.add(gid);
      return drySubtask(gid, stage);
    },

    async ensureLifecycleSubtasks(taskGid) {
      note(`Asana: open every standing subtask on ${taskGid}`);
      return await listSubtasks(taskGid);
    },

    async ensureFixSubtask(taskGid, issue, options) {
      const name = fixSubtaskName(issue.caseName);
      const existing = (await listSubtasks(taskGid)).find(
        (subtask) => subtask.name === name,
      );
      if (existing !== undefined) return existing;
      note(
        `Asana: open "${name}" on ${taskGid}${
          options?.assignee === undefined ? '' : `, for ${options.assignee}`
        }`,
      );
      const gid = `dry-fix-${taskGid}-${issue.caseName}`;
      invented.add(gid);
      return drySubtask(gid, name);
    },

    assignSubtask(gid, assignee) {
      note(`Asana: assign ${gid} to ${assignee}`);
      return Promise.resolve(drySubtask(gid, gid));
    },

    reportOnSubtask(gid, text) {
      note(`Asana: comment on ${gid}: ${text.split('\n').join(' / ')}`);
      return Promise.resolve();
    },

    completeSubtask(gid) {
      note(`Asana: mark ${gid} done`);
      return Promise.resolve({ ...drySubtask(gid, gid), completed: true });
    },

    reopenSubtask(gid) {
      note(`Asana: reopen ${gid}`);
      return Promise.resolve(drySubtask(gid, gid));
    },
  };
}

/**
 * The runner, composing and spawning nothing.
 *
 * It hands back a result that did not finish, on purpose. A dry run that
 * returned a cheerful success would have the manager go on to check evidence
 * nobody produced, and the log would read like a sweep that worked.
 */
export function dryRunner(
  note: (line: string) => void,
  prompts: ComposedPrompt[],
): RunnerPort {
  return {
    delegate(options: DelegateOptions) {
      const prompt = composePrompt(options);
      prompts.push({
        label: options.label,
        agent: options.agent ?? options.label,
        cwd: options.cwd,
        timeoutMs: options.timeoutMs,
        prompt,
      });
      note(
        `Spawn: ${options.agent ?? 'a worker'} for ${options.label} in ${options.cwd}, prompt of ${prompt.length} characters`,
      );

      return Promise.resolve({
        label: options.label,
        ok: false,
        exitCode: null,
        signal: null,
        timedOut: false,
        durationMs: 0,
        promptPath: '(dry run, not written)',
        logPath: '(dry run, not written)',
        result: undefined,
        structuredOutput: undefined,
        sessionId: undefined,
        costUsd: undefined,
        error: 'dry run, so no worker was spawned',
      } satisfies DelegateResult);
    },
  };
}

/** The gated release, described and not run. Nothing is deployed, nothing published. */
export function dryRelease(
  config: Config,
  note: (line: string) => void,
): (component: ComponentRow) => Promise<ReleaseResult> {
  return (component) => {
    note(
      `Release ${component.name}: ${config.repo.productionCommand ?? 'no production command in config'}, then ${config.npm.publishCommand}, in ${config.repo.pathOrUrl}`,
    );
    return Promise.resolve({
      ok: false,
      steps: [],
      productionUrl: undefined,
      npmUrl: undefined,
      error: 'dry run, so nothing was deployed and nothing was published',
    });
  };
}

/**
 * The same sweep, with every outward door replaced by one that writes the
 * line down instead of going through it.
 *
 * Done at the seams rather than as a flag inside the sweep, deliberately. A
 * dry run whose safety depends on an `if` in the middle of the logic is one
 * refactor away from writing for real, and the thing it is protecting is a
 * public npm publish.
 */
export function dryRun(
  deps: SweepDeps,
  log: MutableDryRunLog = dryLog(),
): {
  readonly deps: SweepDeps;
  readonly log: MutableDryRunLog;
} {
  const note = (line: string): void => {
    log.would.push(line);
  };

  // The lanes are left as they are. They spawn through the runner, and the
  // runner they were built with is the dry one, wired where the crew is put
  // together. This replaces the two doors that write: the base and the board.
  return {
    deps: {
      ...deps,
      airtable: dryAirtable(deps.airtable, note),
      asana: dryAsana(deps.asana, note),
      releaseRun: dryRelease(deps.config, note),
    },
    log,
  };
}

/** What a dry run would have done, in the order it would have done it. */
export function describeDryRun(log: DryRunLog): string {
  const lines = [
    `${log.would.length} ${log.would.length === 1 ? 'thing' : 'things'} a real sweep would have done, and did not:`,
    ...log.would.map((line) => `  ${line}`),
  ];

  if (log.prompts.length > 0) {
    lines.push('');
    lines.push(`${log.prompts.length} prompts composed and not sent:`);
    for (const prompt of log.prompts) {
      lines.push(
        `  ${prompt.label} (${prompt.agent}), ${prompt.prompt.length} characters, in ${prompt.cwd}`,
      );
    }
  }

  return lines.join('\n');
}
