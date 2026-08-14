import { z } from 'zod';
import { AsanaRequestError } from './errors.js';

const API = 'https://app.asana.com/api/1.0';

export const taskSchema = z.object({
  gid: z.string(),
  name: z.string().default(''),
  notes: z.string().default(''),
  completed: z.boolean().default(false),
  permalink_url: z.string().optional(),
  parent: z.object({ gid: z.string() }).nullish(),
  assignee: z
    .object({ gid: z.string(), name: z.string().default('') })
    .nullish(),
});

export type TaskData = z.infer<typeof taskSchema>;

export const storySchema = z.object({
  gid: z.string(),
  text: z.string().default(''),
  resource_subtype: z.string().default(''),
  created_at: z.string().optional(),
  created_by: z
    .object({ gid: z.string(), name: z.string().default('') })
    .nullish(),
});

export type StoryData = z.infer<typeof storySchema>;

export interface CreateTaskBody {
  readonly name: string;
  readonly notes?: string;
  readonly projects?: readonly string[];
  readonly parent?: string;
  readonly workspace?: string;
  readonly assignee?: string;
}

export interface UpdateTaskBody {
  readonly name?: string;
  readonly notes?: string;
  readonly completed?: boolean;
  readonly assignee?: string | null;
}

/**
 * The Asana calls this crew makes, and no others. The real one talks to the
 * API, tests hand the client a fake and never touch the network.
 */
export interface AsanaGateway {
  listProjectTasks(projectGid: string): Promise<TaskData[]>;
  listSubtasks(taskGid: string): Promise<TaskData[]>;
  getTask(taskGid: string): Promise<TaskData>;
  createTask(body: CreateTaskBody): Promise<TaskData>;
  createSubtask(parentGid: string, body: CreateTaskBody): Promise<TaskData>;
  updateTask(taskGid: string, body: UpdateTaskBody): Promise<TaskData>;
  listStories(taskGid: string): Promise<StoryData[]>;
  createComment(taskGid: string, text: string): Promise<StoryData>;
}

const TASK_FIELDS =
  'gid,name,notes,completed,permalink_url,parent.gid,assignee.gid,assignee.name';
const STORY_FIELDS =
  'gid,text,resource_subtype,created_at,created_by.gid,created_by.name';

const envelope = z.object({
  data: z.unknown(),
  next_page: z.object({ offset: z.string() }).nullish(),
});

export function httpAsanaGateway(
  token: string,
  fetchImpl: typeof fetch = fetch,
): AsanaGateway {
  async function call(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown,
  ): Promise<{ data: unknown; offset: string | undefined }> {
    const response = await fetchImpl(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify({ data: body }) }),
    });

    const text = await response.text().catch(() => '');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = undefined;
    }

    if (!response.ok) {
      const errors = (parsed as { errors?: { message?: string }[] } | undefined)
        ?.errors;
      const hint =
        response.status === 401
          ? 'check ASANA_TOKEN'
          : response.status === 403
            ? 'the token cannot see this workspace or project'
            : response.status === 429
              ? 'rate limited, try again shortly'
              : (errors?.[0]?.message ?? text.slice(0, 200));
      throw new AsanaRequestError(response.status, path, hint);
    }

    const shaped = envelope.parse(parsed);
    return { data: shaped.data, offset: shaped.next_page?.offset };
  }

  /** Asana pages at 100 by default. Follow the offsets to the end. */
  async function page<T>(path: string, schema: z.ZodType<T>): Promise<T[]> {
    const out: T[] = [];
    let offset: string | undefined;

    do {
      const joiner = path.includes('?') ? '&' : '?';
      const url =
        offset === undefined
          ? `${path}${joiner}limit=100`
          : `${path}${joiner}limit=100&offset=${encodeURIComponent(offset)}`;
      const result = await call('GET', url);
      out.push(...z.array(schema).parse(result.data));
      offset = result.offset;
    } while (offset !== undefined);

    return out;
  }

  return {
    listProjectTasks: (projectGid) =>
      page(
        `/projects/${projectGid}/tasks?opt_fields=${TASK_FIELDS}`,
        taskSchema,
      ),

    listSubtasks: (taskGid) =>
      page(`/tasks/${taskGid}/subtasks?opt_fields=${TASK_FIELDS}`, taskSchema),

    async getTask(taskGid) {
      const { data } = await call(
        'GET',
        `/tasks/${taskGid}?opt_fields=${TASK_FIELDS}`,
      );
      return taskSchema.parse(data);
    },

    async createTask(body) {
      const { data } = await call(
        'POST',
        `/tasks?opt_fields=${TASK_FIELDS}`,
        body,
      );
      return taskSchema.parse(data);
    },

    async createSubtask(parentGid, body) {
      const { data } = await call(
        'POST',
        `/tasks/${parentGid}/subtasks?opt_fields=${TASK_FIELDS}`,
        body,
      );
      return taskSchema.parse(data);
    },

    async updateTask(taskGid, body) {
      const { data } = await call(
        'PUT',
        `/tasks/${taskGid}?opt_fields=${TASK_FIELDS}`,
        body,
      );
      return taskSchema.parse(data);
    },

    listStories: (taskGid) =>
      page(`/tasks/${taskGid}/stories?opt_fields=${STORY_FIELDS}`, storySchema),

    async createComment(taskGid, text) {
      const { data } = await call(
        'POST',
        `/tasks/${taskGid}/stories?opt_fields=${STORY_FIELDS}`,
        { text },
      );
      return storySchema.parse(data);
    },
  };
}
