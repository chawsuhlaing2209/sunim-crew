import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CONFIG_PATH_KEY,
  DEFAULT_CONFIG_FILE,
  OVERRIDES,
  OVERRIDE_KEYS,
  SECRET_KEYS,
  secretsSchema,
} from './env.js';
import type { OverrideKey, Secrets } from './env.js';
import { GROUP_KEYS, projectSchema, slugFromRepo } from './schema.js';
import type { AgentKey, FieldKey, ProjectConfig, TableKey } from './schema.js';

export {
  CONFIG_PATH_KEY,
  DEFAULT_CONFIG_FILE,
  OVERRIDES,
  OVERRIDE_KEYS,
  OPTIONAL_SECRET_KEYS,
  PUBLISH_SECRET_KEYS,
  SECRET_KEYS,
  secretsSchema,
} from './env.js';
export type { OverrideKey, Secrets, SecretKey } from './env.js';

export {
  AGENT_KEYS,
  EVIDENCE_FIELD_KEYS,
  FIELD_KEYS,
  FIELD_TABLE,
  FORMULA_FIELD_KEYS,
  TABLE_KEYS,
  fieldsSchema,
  projectSchema,
  slugFromRepo,
  tablesSchema,
} from './schema.js';
export type {
  AgentKey,
  EvidenceFieldKey,
  FieldKey,
  FormulaFieldKey,
  ProjectConfig,
  TableKey,
} from './schema.js';

/**
 * What the rest of the crew reads. Two sources, one shape: secrets come from
 * the environment, everything project-specific comes from the config file,
 * which the environment can override.
 */
export interface Config {
  readonly anthropic: { readonly apiKey: string };
  readonly github: { readonly token: string };
  readonly airtable: {
    readonly token: string;
    readonly baseId: string;
    readonly tables: Readonly<Record<TableKey, string>>;
    readonly fields: Readonly<Record<FieldKey, string>>;
  };
  readonly asana: {
    readonly token: string;
    readonly workspaceId: string;
    readonly projectId: string;
    /** Role to Asana user. A role nobody holds is left unassigned. */
    readonly agents: Readonly<Partial<Record<AgentKey, string>>>;
  };
  readonly figma: {
    readonly token: string;
    readonly fileKey?: string;
    /** The MCP server the engineer reads the design through. */
    readonly mcpUrl: string;
  };
  readonly chromatic: { readonly projectToken?: string };
  readonly npm: {
    readonly token?: string;
    readonly registry: string;
    readonly publishCommand: string;
  };
  readonly docs: {
    /** Where a component page is written. */
    readonly path?: string;
    /** Where that page appears once the site is built. {slug} is the slug. */
    readonly urlTemplate?: string;
    readonly deployCommand?: string;
  };
  /** Who may approve a production deploy. Empty means nobody can. */
  readonly approvers: readonly string[];
  readonly repo: {
    readonly pathOrUrl: string;
    readonly stagingBranch: string;
    readonly mainBranch: string;
    readonly slug?: string;
    /** The one command that puts a branch on staging, when the repo has one. */
    readonly stageCommand?: string;
    /** How production is deployed. Held by the gated step alone. */
    readonly productionCommand?: string;
    /** Where a component lives in production. {slug} is the component slug. */
    readonly productionUrlTemplate?: string;
  };
}

/** Thrown when config is incomplete. Names and paths only, never values. */
export class ConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(
      [
        'Configuration is incomplete. Fix these:',
        ...problems.map((line) => `  - ${line}`),
        `Secrets go in the environment, see .env.example. Everything else goes in ${DEFAULT_CONFIG_FILE}, see sunim.config.example.json. Then run npm run config:check.`,
      ].join('\n'),
    );
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

type Env = Readonly<Record<string, string | undefined>>;
type Plain = Record<string, unknown>;

/**
 * An unset variable and an empty one mean the same thing: absent.
 *
 * A value that begins with # is also absent. That is what a mis-parsed
 * comment looks like, and Node's --env-file leaves the inline comment on the
 * final assignment in a file, so a .env ending in
 *
 *   NPM_TOKEN=            # npmjs.com, publish scope
 *
 * hands back the comment as the value. Read literally, a fresh clone would
 * believe it holds a publish key. No real token starts with a hash.
 */
function value(env: Env, key: string): string | undefined {
  const raw = env[key];
  if (typeof raw !== 'string') return undefined;

  const trimmed = raw.trim();
  return trimmed === '' || trimmed.startsWith('#') ? undefined : trimmed;
}

function setPath(target: Plain, path: string, next: string): void {
  const parts = path.split('.');
  const leaf = parts.pop();
  if (leaf === undefined) return;
  let node = target;
  for (const part of parts) {
    const existing = node[part];
    const child =
      typeof existing === 'object' &&
      existing !== null &&
      !Array.isArray(existing)
        ? (existing as Plain)
        : {};
    node[part] = child;
    node = child;
  }
  node[leaf] = next;
}

function getPath(source: Plain, path: string): unknown {
  let node: unknown = source;
  for (const part of path.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Plain)[part];
  }
  return node;
}

/**
 * Copy the parsed file, dropping empty values. A key left blank in the config
 * file means the same as a key that is not there, so an example file people
 * fill in one line at a time reads cleanly.
 */
function clone(input: unknown): Plain {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }
  const out: Plain = {};
  for (const [key, raw] of Object.entries(input as Plain)) {
    if (typeof raw === 'string') {
      if (raw.trim() !== '') out[key] = raw.trim();
    } else if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
      out[key] = clone(raw);
    } else if (raw !== undefined && raw !== null) {
      out[key] = raw;
    }
  }
  return out;
}

/**
 * The file merged with its environment overrides. Groups are seeded so a
 * missing value is reported at its leaf, airtable.baseId, not at airtable.
 */
function merge(file: unknown, env: Env): Plain {
  const merged = clone(file);
  for (const group of GROUP_KEYS) {
    const existing = merged[group];
    if (existing === undefined || typeof existing !== 'object') {
      merged[group] = {};
    }
  }
  for (const [key, path] of Object.entries(OVERRIDES)) {
    const found = value(env, key);
    if (found !== undefined) setPath(merged, path, found);
  }
  return merged;
}

/** The environment name that can set a config path, for error messages. */
function overrideFor(path: string): OverrideKey | undefined {
  return OVERRIDE_KEYS.find((key) => OVERRIDES[key] === path);
}

/** Drop keys whose value is undefined, so an absent role stays absent. */
function defined<T extends string>(
  source: Readonly<Record<string, string | undefined>>,
): Partial<Record<T, string>> {
  const out: Partial<Record<T, string>> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) out[key as T] = value;
  }
  return out;
}

function toConfig(secrets: Secrets, project: ProjectConfig): Config {
  const slug = project.repo.slug ?? slugFromRepo(project.repo.pathOrUrl);

  return Object.freeze({
    anthropic: Object.freeze({ apiKey: secrets.ANTHROPIC_API_KEY }),
    github: Object.freeze({ token: secrets.GITHUB_TOKEN }),
    airtable: Object.freeze({
      token: secrets.AIRTABLE_TOKEN,
      baseId: project.airtable.baseId,
      tables: Object.freeze({ ...project.airtable.tables }),
      fields: Object.freeze({ ...project.airtable.fields }),
    }),
    asana: Object.freeze({
      token: secrets.ASANA_TOKEN,
      workspaceId: project.asana.workspaceId,
      projectId: project.asana.projectId,
      agents: Object.freeze(defined<AgentKey>(project.asana.agents)),
    }),
    figma: Object.freeze({
      token: secrets.FIGMA_TOKEN,
      mcpUrl: project.figma.mcpUrl,
      ...(project.figma.fileKey === undefined
        ? {}
        : { fileKey: project.figma.fileKey }),
    }),
    chromatic: Object.freeze(
      secrets.CHROMATIC_TOKEN === undefined
        ? {}
        : { projectToken: secrets.CHROMATIC_TOKEN },
    ),
    npm: Object.freeze({
      registry: project.npm.registry,
      publishCommand: project.npm.publishCommand,
      ...(secrets.NPM_TOKEN === undefined ? {} : { token: secrets.NPM_TOKEN }),
    }),
    docs: Object.freeze({
      ...(project.docs.path === undefined ? {} : { path: project.docs.path }),
      ...(project.docs.urlTemplate === undefined
        ? {}
        : { urlTemplate: project.docs.urlTemplate }),
      ...(project.docs.deployCommand === undefined
        ? {}
        : { deployCommand: project.docs.deployCommand }),
    }),
    approvers: Object.freeze([...project.approvers]),
    repo: Object.freeze({
      pathOrUrl: project.repo.pathOrUrl,
      stagingBranch: project.repo.stagingBranch,
      mainBranch: project.repo.mainBranch,
      ...(slug === undefined ? {} : { slug }),
      ...(project.repo.stageCommand === undefined
        ? {}
        : { stageCommand: project.repo.stageCommand }),
      ...(project.repo.productionCommand === undefined
        ? {}
        : { productionCommand: project.repo.productionCommand }),
      ...(project.repo.productionUrlTemplate === undefined
        ? {}
        : { productionUrlTemplate: project.repo.productionUrlTemplate }),
    }),
  });
}

export interface LoadOptions {
  /** The environment to read secrets and overrides from. */
  readonly env?: Env;
  /** The parsed config file, or nothing when there is no file. */
  readonly project?: unknown;
}

/**
 * Pure. Give it an environment and a parsed config file, get a frozen config
 * or a ConfigError that names every problem at once.
 */
export function loadConfig(options: LoadOptions = {}): Config {
  const env = options.env ?? process.env;
  const problems: string[] = [];

  const present: Record<string, string> = {};
  for (const key of SECRET_KEYS) {
    const found = value(env, key);
    if (found !== undefined) present[key] = found;
  }
  const secrets = secretsSchema.safeParse(present);
  if (!secrets.success) {
    for (const issue of secrets.error.issues) {
      const key = String(issue.path[0] ?? '(unknown)');
      problems.push(
        `${key} ${present[key] === undefined ? 'is not set' : issue.message}`,
      );
    }
  }

  const merged = merge(options.project, env);
  const project = projectSchema.safeParse(merged);
  if (!project.success) {
    for (const issue of project.error.issues) {
      const path = issue.path.join('.');
      const override = overrideFor(path);
      const where = override === undefined ? '' : ` or set ${override}`;
      const reason =
        getPath(merged, path) === undefined ? 'is not set' : issue.message;
      problems.push(`${path} ${reason} in ${DEFAULT_CONFIG_FILE}${where}`);
    }
  }

  if (!secrets.success || !project.success) {
    throw new ConfigError([...new Set(problems)].sort());
  }

  return toConfig(secrets.data, project.data);
}

/** Read the config file. Returns nothing when there is no file to read. */
export function readProjectFile(
  env: Env = process.env,
): { path: string; data: unknown } | undefined {
  const path = resolve(value(env, CONFIG_PATH_KEY) ?? DEFAULT_CONFIG_FILE);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
  try {
    return { path, data: JSON.parse(text) as unknown };
  } catch (error) {
    throw new ConfigError([
      `${path} is not valid JSON: ${(error as Error).message}`,
    ]);
  }
}

let cached: Config | undefined;

/** The process-wide config. Loaded on first ask, never at import time. */
export function getConfig(env: Env = process.env): Config {
  cached ??= loadConfig({ env, project: readProjectFile(env)?.data });
  return cached;
}

/** Drop the cache. For tests, and for a reload after config changes. */
export function resetConfig(): void {
  cached = undefined;
}

/**
 * Demand a value that is optional at load time. The gated publish step calls
 * this for the npm token, so a missing key fails at the step that needs it
 * rather than blocking a clone that only wants to run a sweep.
 */
export function requireValue(
  found: string | undefined,
  name: string,
  purpose: string,
): string {
  if (found === undefined || found.trim() === '') {
    throw new ConfigError([`${name} is not set, and ${purpose} needs it`]);
  }
  return found;
}

export interface Report {
  readonly name: string;
  readonly state: 'set' | 'missing' | 'default';
  readonly detail: string;
}

/** A masked view for printing and logging. Never returns a real secret. */
export function report(options: LoadOptions = {}): Report[] {
  const env = options.env ?? process.env;
  const rows: Report[] = [];

  for (const key of SECRET_KEYS) {
    const found = value(env, key);
    rows.push({
      name: key,
      state: found === undefined ? 'missing' : 'set',
      detail:
        found === undefined ? 'not set' : `set, ${found.length} characters`,
    });
  }

  const project = projectSchema.safeParse(merge(options.project, env));
  if (project.success) {
    const data = project.data;
    const fromEnv = (path: string) => {
      const key = overrideFor(path);
      return key !== undefined && value(env, key) !== undefined;
    };
    const add = (path: string, found: string | undefined) => {
      rows.push({
        name: path,
        state: found === undefined ? 'missing' : 'set',
        detail:
          found === undefined
            ? 'not set'
            : `${found}${fromEnv(path) ? ' (from the environment)' : ''}`,
      });
    };
    add('airtable.baseId', data.airtable.baseId);
    add('asana.workspaceId', data.asana.workspaceId);
    add('asana.projectId', data.asana.projectId);
    add('repo.pathOrUrl', data.repo.pathOrUrl);
    add('repo.stagingBranch', data.repo.stagingBranch);
    add('repo.mainBranch', data.repo.mainBranch);
    add('repo.slug', data.repo.slug ?? slugFromRepo(data.repo.pathOrUrl));
    add('figma.fileKey', data.figma.fileKey);
    add('npm.registry', data.npm.registry);
  }

  return rows;
}
