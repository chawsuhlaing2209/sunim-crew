import { z } from 'zod';
import { AGENT_KEYS, FIELD_KEYS, TABLE_KEYS } from './schema.js';

/**
 * The environment surface. Secrets live here and only here: never in the
 * config file, never in a prompt, never in a tracked file. Each teammate runs
 * with their own keys.
 */
export const secretsSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, 'must not be empty'),
  GITHUB_TOKEN: z.string().min(1, 'must not be empty'),
  AIRTABLE_TOKEN: z.string().min(1, 'must not be empty'),
  ASANA_TOKEN: z.string().min(1, 'must not be empty'),
  FIGMA_TOKEN: z.string().min(1, 'must not be empty'),
  // Needed only when visual tests run.
  CHROMATIC_TOKEN: z.string().min(1, 'must not be empty').optional(),
  // Needed only by the gated publish step. A worker never receives this.
  NPM_TOKEN: z.string().min(1, 'must not be empty').optional(),
});

export type Secrets = z.infer<typeof secretsSchema>;
export type SecretKey = keyof Secrets;

export const SECRET_KEYS = Object.keys(secretsSchema.shape) as SecretKey[];

/** Secrets that must never reach a worker. Only the gated step holds them. */
export const PUBLISH_SECRET_KEYS: readonly SecretKey[] = ['NPM_TOKEN'];

/** Secrets a step may run without, until the step that needs them. */
export const OPTIONAL_SECRET_KEYS: readonly SecretKey[] = [
  'CHROMATIC_TOKEN',
  'NPM_TOKEN',
];

/** componentLink becomes COMPONENT_LINK, so the names read the same way. */
function screaming(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase();
}

/**
 * Environment names for everything project-specific. Nothing here is a
 * secret. Each maps to a dotted path in the project config, so the whole
 * surface fits in a .env with no config file at all. A config file, when
 * there is one, fills in anything the environment leaves out.
 *
 * The table and field names are generated from the keys, so adding a field to
 * the map gives it an environment name for free.
 */
export const OVERRIDES: Readonly<Record<string, string>> = {
  AIRTABLE_BASE_ID: 'airtable.baseId',
  ASANA_WORKSPACE_ID: 'asana.workspaceId',
  ASANA_PROJECT_ID: 'asana.projectId',
  FIGMA_FILE_KEY: 'figma.fileKey',
  REPO_PATH_OR_URL: 'repo.pathOrUrl',
  REPO_STAGING_BRANCH: 'repo.stagingBranch',
  REPO_MAIN_BRANCH: 'repo.mainBranch',
  GITHUB_REPO: 'repo.slug',
  NPM_REGISTRY: 'npm.registry',
  ...Object.fromEntries(
    TABLE_KEYS.map((key) => [
      `AIRTABLE_TABLE_${screaming(key)}`,
      `airtable.tables.${key}`,
    ]),
  ),
  ...Object.fromEntries(
    FIELD_KEYS.map((key) => [
      `AIRTABLE_FIELD_${screaming(key)}`,
      `airtable.fields.${key}`,
    ]),
  ),
  ...Object.fromEntries(
    AGENT_KEYS.map((key) => [
      `ASANA_AGENT_${screaming(key)}`,
      `asana.agents.${key}`,
    ]),
  ),
};

export type OverrideKey = string;

export const OVERRIDE_KEYS = Object.keys(OVERRIDES);

/** Where the config file lives, when it is not ./sunim.config.json */
export const CONFIG_PATH_KEY = 'SUNIM_CONFIG';

export const DEFAULT_CONFIG_FILE = 'sunim.config.json';
