import { beforeEach, describe, expect, it } from 'vitest';
import {
  KEY_MARKER,
  MANAGER_MARKER,
  STAGE_ROLE,
  TaskKeyConflictError,
  airtableRowUrl,
  createAsanaClient,
  parseKey,
  renderKey,
  stageOf,
} from './index.js';
import type {
  AsanaClient,
  AsanaGateway,
  StoryData,
  TaskData,
} from './index.js';

const PROJECT = '0000000000000001';
const WORKSPACE = '0000000000000002';

/** An Asana that lives in memory, so no test touches the network. */
function fakeAsana(): { gateway: AsanaGateway; tasks: Map<string, TaskData> } {
  const tasks = new Map<string, TaskData>();
  const projectOf = new Map<string, string>();
  const stories = new Map<string, StoryData[]>();
  let next = 1;

  const make = (body: {
    name: string;
    notes?: string;
    assignee?: string;
    parent?: string;
  }): TaskData => {
    const gid = `task${next++}`;
    const task: TaskData = {
      gid,
      name: body.name,
      notes: body.notes ?? '',
      completed: false,
      permalink_url: `https://app.asana.com/0/${PROJECT}/${gid}`,
      ...(body.parent === undefined ? {} : { parent: { gid: body.parent } }),
      ...(body.assignee === undefined
        ? {}
        : { assignee: { gid: body.assignee, name: body.assignee } }),
    };
    tasks.set(gid, task);
    return task;
  };

  const gateway: AsanaGateway = {
    listProjectTasks: (projectGid) =>
      Promise.resolve(
        [...tasks.values()].filter(
          (task) =>
            projectOf.get(task.gid) === projectGid && task.parent == null,
        ),
      ),
    listSubtasks: (taskGid) =>
      Promise.resolve(
        [...tasks.values()].filter((task) => task.parent?.gid === taskGid),
      ),
    getTask: (taskGid) => {
      const task = tasks.get(taskGid);
      if (task === undefined) throw new Error(`no task ${taskGid}`);
      return Promise.resolve(task);
    },
    createTask: (body) => {
      const task = make(body);
      for (const projectGid of body.projects ?? []) {
        projectOf.set(task.gid, projectGid);
      }
      return Promise.resolve(task);
    },
    createSubtask: (parentGid, body) =>
      Promise.resolve(make({ ...body, parent: parentGid })),
    updateTask: (taskGid, body) => {
      const task = tasks.get(taskGid);
      if (task === undefined) throw new Error(`no task ${taskGid}`);
      const updated: TaskData = {
        ...task,
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.notes === undefined ? {} : { notes: body.notes }),
        ...(body.completed === undefined ? {} : { completed: body.completed }),
        ...(body.assignee === undefined || body.assignee === null
          ? {}
          : { assignee: { gid: body.assignee, name: body.assignee } }),
      };
      tasks.set(taskGid, updated);
      return Promise.resolve(updated);
    },
    listStories: (taskGid) => Promise.resolve(stories.get(taskGid) ?? []),
    createComment: (taskGid, text) => {
      const story: StoryData = {
        gid: `story${next++}`,
        text,
        resource_subtype: 'comment_added',
        created_at: '2026-08-14T10:00:00.000Z',
        created_by: { gid: 'user-engineer', name: 'Engineer' },
      };
      stories.set(taskGid, [...(stories.get(taskGid) ?? []), story]);
      return Promise.resolve(story);
    },
  };

  return { gateway, tasks };
}

const KEY = {
  component: 'Button',
  recordId: 'recXXXXXXXXXXXXXX',
  rowUrl: airtableRowUrl(
    'appXXXXXXXXXXXXXX',
    'tblXXXXXXXXXXXXXX',
    'recXXXXXXXXXXXXXX',
  ),
};

describe('the key block', () => {
  it('round trips through the task description', () => {
    expect(parseKey(renderKey(KEY))).toEqual(KEY);
  });

  it('survives a person writing above it', () => {
    const notes = `Some notes a human added.\n\n${renderKey(KEY)}`;

    expect(parseKey(notes)?.recordId).toBe(KEY.recordId);
  });

  it('returns nothing when there is no block', () => {
    expect(parseKey('just a description')).toBeUndefined();
    expect(parseKey(`${KEY_MARKER}\ncomponent: Button`)).toBeUndefined();
  });
});

describe('stageOf', () => {
  it('reads a lifecycle stage back from a subtask name', () => {
    expect(stageOf('Implementation')).toBe('Implementation');
    expect(stageOf('Document')).toBe('Document');
    expect(stageOf('Fix: Button, primary, hover')).toBe('Fix');
    expect(stageOf('Something else')).toBeUndefined();
  });

  it('has an owner for every stage', () => {
    expect(STAGE_ROLE.Implementation).toBe('Engineer');
    expect(STAGE_ROLE.Test).toBe('QA');
    expect(STAGE_ROLE.Deploy).toBe('DevOps');
    expect(STAGE_ROLE.Document).toBe('Manager');
  });
});

describe('the client', () => {
  let client: AsanaClient;
  let gateway: AsanaGateway;

  beforeEach(() => {
    const fake = fakeAsana();
    gateway = fake.gateway;
    client = createAsanaClient(fake.gateway, PROJECT, WORKSPACE);
  });

  it('creates one task per component, keyed to the Airtable row', async () => {
    const task = await client.ensureComponentTask(KEY);

    expect(task.name).toBe('Button');
    expect(task.key.recordId).toBe(KEY.recordId);
    expect(task.key.rowUrl).toContain('recXXXXXXXXXXXXXX');
  });

  it('finds the same task again instead of making a second one', async () => {
    const first = await client.ensureComponentTask(KEY);
    const second = await client.ensureComponentTask(KEY);

    expect(second.gid).toBe(first.gid);
  });

  it('follows the record id when the component is renamed', async () => {
    const first = await client.ensureComponentTask(KEY);
    const renamed = await client.ensureComponentTask({
      ...KEY,
      component: 'Button group',
    });

    expect(renamed.gid).toBe(first.gid);
  });

  it('refuses two components that share a name', async () => {
    await client.ensureComponentTask(KEY);

    await expect(
      client.ensureComponentTask({ ...KEY, recordId: 'recOtherRow00000' }),
    ).rejects.toThrow(TaskKeyConflictError);
  });

  it('adopts a task someone made by hand, adding the key block', async () => {
    const byHand = await gateway.createTask({
      name: 'Button',
      notes: 'I made this in the app',
      projects: [PROJECT],
    });

    const task = await client.ensureComponentTask(KEY);

    expect(task.gid).toBe(byHand.gid);
    expect(task.key.recordId).toBe(KEY.recordId);
    expect((await gateway.getTask(byHand.gid)).notes).toContain(
      'I made this in the app',
    );
  });

  it('opens the five standing subtasks, and not Fix', async () => {
    const task = await client.ensureComponentTask(KEY);
    const subtasks = await client.ensureLifecycleSubtasks(task.gid);

    expect(subtasks.map((subtask) => subtask.name)).toEqual([
      'Implementation',
      'Stage',
      'Test',
      'Deploy',
      'Document',
    ]);
  });

  it('writes the bar for the stage into the subtask', async () => {
    const task = await client.ensureComponentTask(KEY);
    const subtask = await client.ensureSubtask(task.gid, 'Implementation');

    expect(subtask.notes).toContain('Done when:');
    expect(subtask.notes).toContain('commit pushed');
  });

  it('does not open a second subtask for a stage that is already there', async () => {
    const task = await client.ensureComponentTask(KEY);
    const first = await client.ensureSubtask(task.gid, 'Stage');
    const again = await client.ensureSubtask(task.gid, 'Stage');

    expect(again.gid).toBe(first.gid);
    expect(await client.listSubtasks(task.gid)).toHaveLength(1);
  });

  it('assigns a subtask, and fills in an assignee that was missing', async () => {
    const task = await client.ensureComponentTask(KEY);
    const subtask = await client.ensureSubtask(task.gid, 'Test');
    expect(subtask.assignee).toBeUndefined();

    const assigned = await client.assignSubtask(subtask.gid, 'qa@example.com');
    expect(assigned.assignee?.gid).toBe('qa@example.com');

    const again = await client.ensureSubtask(task.gid, 'Test', {
      assignee: 'someone-else@example.com',
    });
    // Already assigned, so it is left alone.
    expect(again.assignee?.gid).toBe('qa@example.com');
  });

  it('opens one Fix subtask per failed case, carrying only that case', async () => {
    const task = await client.ensureComponentTask(KEY);
    const fix = await client.ensureFixSubtask(task.gid, {
      caseName: 'Button, primary, hover',
      expected: 'Background moves to accent-hover',
      suggestion: 'Bind the hover state to the accent-hover token',
    });

    expect(fix.name).toBe('Fix: Button, primary, hover');
    expect(fix.stage).toBe('Fix');
    expect(fix.notes).toContain('Expected: Background moves to accent-hover');
    expect(fix.notes).toContain('do not re-diagnose');
  });

  it('reads whether a subtask is done', async () => {
    const task = await client.ensureComponentTask(KEY);
    const subtask = await client.ensureSubtask(task.gid, 'Implementation');

    expect(await client.isSubtaskDone(subtask.gid)).toBe(false);

    await client.completeSubtask(subtask.gid);
    expect(await client.isSubtaskDone(subtask.gid)).toBe(true);
  });

  it('reads the result the agent wrote, newest comment first', async () => {
    const task = await client.ensureComponentTask(KEY);
    const subtask = await client.ensureSubtask(task.gid, 'Implementation');

    await client.reportOnSubtask(subtask.gid, 'Started, nothing yet');
    await client.reportOnSubtask(
      subtask.gid,
      'Built. Commit https://github.com/owner/ds/commit/abc1234',
    );

    const report = await client.readResult(subtask.gid);

    expect(report?.source).toBe('comment');
    expect(report?.text).toContain('commit/abc1234');
    expect(report?.authorName).toBe('Engineer');
  });

  it('never reads the manager’s own note back as a worker report', async () => {
    const task = await client.ensureComponentTask(KEY);
    const subtask = await client.ensureSubtask(task.gid, 'Implementation');

    await client.reportOnSubtask(
      subtask.gid,
      'Built. Commit https://github.com/owner/ds/commit/abc1234',
    );
    // The manager refuses it, and its refusal is the newest comment.
    await client.reportOnSubtask(
      subtask.gid,
      `${MANAGER_MARKER}\n\nThat commit does not resolve.`,
    );

    const report = await client.readResult(subtask.gid);

    expect(report?.text).toContain('commit/abc1234');
    expect(report?.text).not.toContain(MANAGER_MARKER);
  });

  it('falls back to the description when no comment was written', async () => {
    const task = await client.ensureComponentTask(KEY);
    const subtask = await client.ensureSubtask(task.gid, 'Stage');

    const report = await client.readResult(subtask.gid);

    expect(report?.source).toBe('notes');
    expect(report?.text).toContain('Done when:');
  });

  it('reads nothing from a subtask nobody has touched', async () => {
    const bare = await gateway.createSubtask('task-none', { name: 'Empty' });

    expect(await client.readResult(bare.gid)).toBeUndefined();
  });
});
