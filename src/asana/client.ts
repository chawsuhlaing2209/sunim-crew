import type { Config } from '../config/index.js';
import { TaskKeyConflictError } from './errors.js';
import { httpAsanaGateway } from './gateway.js';
import type { AsanaGateway, TaskData } from './gateway.js';
import { parseKey, renderKey, withKey } from './key.js';
import {
  LIFECYCLE_STAGES,
  MANAGER_MARKER,
  STAGE_DONE_WHEN,
  STANDING_STAGES,
} from './types.js';
import type {
  AgentReport,
  ComponentKey,
  ComponentTask,
  FixIssue,
  Stage,
  Subtask,
} from './types.js';

/** A Fix subtask is named for the case it fixes: "Fix: Button, primary, hover". */
export const FIX_PREFIX = 'Fix: ';

export function stageOf(name: string): Stage | undefined {
  if (name.startsWith(FIX_PREFIX)) return 'Fix';
  return LIFECYCLE_STAGES.find((stage) => stage === name.trim());
}

export function fixSubtaskName(caseName: string): string {
  return `${FIX_PREFIX}${caseName}`;
}

export interface SubtaskOptions {
  /** Who does it. A user gid or an email address Asana knows. */
  readonly assignee?: string;
  /** Extra context for the agent, kept above the done-when line. */
  readonly notes?: string;
}

export interface AsanaClient {
  ensureComponentTask(key: ComponentKey): Promise<ComponentTask>;
  findComponentTask(key: ComponentKey): Promise<ComponentTask | undefined>;
  listSubtasks(taskGid: string): Promise<Subtask[]>;
  ensureSubtask(
    taskGid: string,
    stage: Exclude<Stage, 'Fix'>,
    options?: SubtaskOptions,
  ): Promise<Subtask>;
  ensureLifecycleSubtasks(taskGid: string): Promise<Subtask[]>;
  ensureFixSubtask(
    taskGid: string,
    issue: FixIssue,
    options?: SubtaskOptions,
  ): Promise<Subtask>;
  assignSubtask(subtaskGid: string, assignee: string): Promise<Subtask>;
  isSubtaskDone(subtaskGid: string): Promise<boolean>;
  readResult(subtaskGid: string): Promise<AgentReport | undefined>;
  /**
   * Every comment on a subtask, with who wrote it. The gate needs the author,
   * because an approval is only an approval when a named person made it.
   */
  listComments(subtaskGid: string): Promise<AgentReport[]>;
  /** The worker side of the pair: report, then mark done. */
  reportOnSubtask(subtaskGid: string, text: string): Promise<void>;
  completeSubtask(subtaskGid: string): Promise<Subtask>;
  /** Done was not true. Put it back so the work is picked up again. */
  reopenSubtask(subtaskGid: string): Promise<Subtask>;
}

function toSubtask(task: TaskData): Subtask {
  return {
    gid: task.gid,
    parentGid: task.parent?.gid ?? undefined,
    name: task.name,
    stage: stageOf(task.name),
    completed: task.completed,
    assignee:
      task.assignee == null
        ? undefined
        : { gid: task.assignee.gid, name: task.assignee.name },
    notes: task.notes,
    permalinkUrl: task.permalink_url,
  };
}

export function createAsanaClient(
  gateway: AsanaGateway,
  projectGid: string,
  workspaceGid: string,
): AsanaClient {
  function toComponentTask(task: TaskData, key: ComponentKey): ComponentTask {
    return {
      gid: task.gid,
      name: task.name,
      key: parseKey(task.notes) ?? key,
      completed: task.completed,
      permalinkUrl: task.permalink_url,
    };
  }

  async function find(key: ComponentKey): Promise<TaskData | undefined> {
    const tasks = await gateway.listProjectTasks(projectGid);

    // The record id is the real key. A rename in Airtable keeps the pairing.
    const byRecord = tasks.find(
      (task) => parseKey(task.notes)?.recordId === key.recordId,
    );
    if (byRecord !== undefined) return byRecord;

    // No keyed task yet. A task with the right name is either the same
    // component from before this key block existed, or a different component
    // that happens to share a name. The second one has to stop.
    const byName = tasks.find((task) => task.name.trim() === key.component);
    if (byName === undefined) return undefined;

    const found = parseKey(byName.notes);
    if (found !== undefined && found.recordId !== key.recordId) {
      throw new TaskKeyConflictError(
        key.component,
        byName.gid,
        found.recordId,
        key.recordId,
      );
    }
    return byName;
  }

  async function subtaskByName(
    taskGid: string,
    name: string,
  ): Promise<Subtask | undefined> {
    const subtasks = await gateway.listSubtasks(taskGid);
    const match = subtasks.find((task) => task.name.trim() === name);
    return match === undefined ? undefined : toSubtask(match);
  }

  async function makeSubtask(
    taskGid: string,
    name: string,
    body: string,
    options: SubtaskOptions,
  ): Promise<Subtask> {
    const existing = await subtaskByName(taskGid, name);
    if (existing !== undefined) {
      return options.assignee !== undefined && existing.assignee === undefined
        ? toSubtask(
            await gateway.updateTask(existing.gid, {
              assignee: options.assignee,
            }),
          )
        : existing;
    }

    const notes =
      options.notes === undefined ? body : `${options.notes}\n\n${body}`;

    return toSubtask(
      await gateway.createSubtask(taskGid, {
        name,
        notes,
        ...(options.assignee === undefined
          ? {}
          : { assignee: options.assignee }),
      }),
    );
  }

  return {
    findComponentTask: async (key) => {
      const found = await find(key);
      return found === undefined ? undefined : toComponentTask(found, key);
    },

    async ensureComponentTask(key) {
      const found = await find(key);
      if (found !== undefined) {
        // An older task without the key block gets one, so the next sweep
        // finds it by record id rather than by name.
        if (parseKey(found.notes) === undefined) {
          const updated = await gateway.updateTask(found.gid, {
            notes: withKey(found.notes, key),
          });
          return toComponentTask(updated, key);
        }
        return toComponentTask(found, key);
      }

      const created = await gateway.createTask({
        name: key.component,
        notes: renderKey(key),
        projects: [projectGid],
        workspace: workspaceGid,
      });
      return toComponentTask(created, key);
    },

    async listSubtasks(taskGid) {
      const subtasks = await gateway.listSubtasks(taskGid);
      return subtasks.map(toSubtask);
    },

    ensureSubtask: (taskGid, stage, options = {}) =>
      makeSubtask(
        taskGid,
        stage,
        `Done when: ${STAGE_DONE_WHEN[stage]}`,
        options,
      ),

    async ensureLifecycleSubtasks(taskGid) {
      const out: Subtask[] = [];
      for (const stage of STANDING_STAGES) {
        if (stage === 'Fix') continue;
        out.push(
          await makeSubtask(
            taskGid,
            stage,
            `Done when: ${STAGE_DONE_WHEN[stage]}`,
            {},
          ),
        );
      }
      return out;
    },

    ensureFixSubtask: (taskGid, issue, options = {}) =>
      makeSubtask(
        taskGid,
        fixSubtaskName(issue.caseName),
        [
          `Case: ${issue.caseName}`,
          `Expected: ${issue.expected}`,
          `Suggestion: ${issue.suggestion}`,
          '',
          `Done when: ${STAGE_DONE_WHEN.Fix}`,
        ].join('\n'),
        options,
      ),

    async assignSubtask(subtaskGid, assignee) {
      return toSubtask(await gateway.updateTask(subtaskGid, { assignee }));
    },

    async isSubtaskDone(subtaskGid) {
      const task = await gateway.getTask(subtaskGid);
      return task.completed;
    },

    /**
     * What the agent wrote when it finished. The newest comment wins, because
     * that is where an agent reports. A subtask with no comment falls back to
     * whatever is in its description below the brief.
     */
    async readResult(subtaskGid) {
      const stories = await gateway.listStories(subtaskGid);
      const comments = stories.filter(
        (story) =>
          story.resource_subtype === 'comment_added' &&
          !story.text.trimStart().startsWith(MANAGER_MARKER),
      );
      const last = comments[comments.length - 1];

      if (last !== undefined && last.text.trim() !== '') {
        return {
          text: last.text.trim(),
          source: 'comment',
          authorGid: last.created_by?.gid,
          authorName: last.created_by?.name,
          createdAt: last.created_at,
        };
      }

      const task = await gateway.getTask(subtaskGid);
      const notes = task.notes.trim();
      return notes === ''
        ? undefined
        : {
            text: notes,
            source: 'notes',
            authorGid: undefined,
            authorName: undefined,
            createdAt: undefined,
          };
    },

    async listComments(subtaskGid) {
      const stories = await gateway.listStories(subtaskGid);
      return stories
        .filter((story) => story.resource_subtype === 'comment_added')
        .map((story) => ({
          text: story.text,
          source: 'comment' as const,
          authorGid: story.created_by?.gid,
          authorName: story.created_by?.name,
          createdAt: story.created_at,
        }));
    },

    async reportOnSubtask(subtaskGid, text) {
      await gateway.createComment(subtaskGid, text);
    },

    async completeSubtask(subtaskGid) {
      return toSubtask(
        await gateway.updateTask(subtaskGid, { completed: true }),
      );
    },

    async reopenSubtask(subtaskGid) {
      return toSubtask(
        await gateway.updateTask(subtaskGid, { completed: false }),
      );
    },
  };
}

/** Build the client from config. The token never leaves this call. */
export function connect(
  config: Config,
  deps: { readonly gateway?: AsanaGateway } = {},
): AsanaClient {
  const gateway = deps.gateway ?? httpAsanaGateway(config.asana.token);
  return createAsanaClient(
    gateway,
    config.asana.projectId,
    config.asana.workspaceId,
  );
}
