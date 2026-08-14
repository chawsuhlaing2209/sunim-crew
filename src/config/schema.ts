import { z } from 'zod';
import { isAbsolute } from 'node:path';

/**
 * The project shape: everything specific to a base, a workspace, a repo.
 * Names, not ids. A duplicated Airtable base keeps the names and gets new
 * ids, so the crew addresses the base by name and resolves ids at startup.
 * The defaults below describe the shipped base template. Point the crew at a
 * base with different names by editing the map, not the code.
 */

const name = (fallback: string) =>
  z.string().min(1, 'must not be empty').default(fallback);

export const tablesSchema = z.object({
  components: name('Components'),
  tests: name('Storybook Testing'),
});

export const fieldsSchema = z.object({
  // Components table.
  figma: name('Figma'),
  design: name('Design'),
  commit: name('Commit'),
  storybook: name('Storybook'),
  stagingUrl: name('Staging URL'),
  productionUrl: name('Production URL'),
  astro: name('Astro Link'),
  development: name('Development'),
  synchronization: name('Synchronization %'),
  totalTests: name('Total Tests'),
  passedTests: name('Passed Tests'),
  // Storybook Testing table.
  testResults: name('Testing Results'),
  componentLink: name('Components'),
});

/** The crew's roles, and who holds each one in your Asana. */
export const agentsSchema = z.object({
  engineer: z.string().min(1).optional(),
  qa: z.string().min(1).optional(),
  devops: z.string().min(1).optional(),
  manager: z.string().min(1).optional(),
});

export type AgentKey = keyof z.infer<typeof agentsSchema>;

export const AGENT_KEYS = Object.keys(agentsSchema.shape) as AgentKey[];

export type TableKey = keyof z.infer<typeof tablesSchema>;
export type FieldKey = keyof z.infer<typeof fieldsSchema>;

export const TABLE_KEYS = Object.keys(tablesSchema.shape) as TableKey[];
export const FIELD_KEYS = Object.keys(fieldsSchema.shape) as FieldKey[];

/** Which table each field lives on. Structure, so it is not configurable. */
export const FIELD_TABLE: Readonly<Record<FieldKey, TableKey>> = {
  figma: 'components',
  design: 'components',
  commit: 'components',
  storybook: 'components',
  stagingUrl: 'components',
  productionUrl: 'components',
  astro: 'components',
  development: 'components',
  synchronization: 'components',
  totalTests: 'components',
  passedTests: 'components',
  testResults: 'tests',
  componentLink: 'tests',
};

/**
 * Formulas. Nobody writes these, ever. The client guards against a write that
 * targets one, and the CI check in step 14 reads this same list.
 */
export type FormulaFieldKey = 'development' | 'synchronization';

export const FORMULA_FIELD_KEYS: readonly FormulaFieldKey[] = [
  'development',
  'synchronization',
];

/** The evidence fields. The manager writes these, only after verifying. */
export type EvidenceFieldKey =
  'commit' | 'storybook' | 'stagingUrl' | 'productionUrl' | 'astro';

export const EVIDENCE_FIELD_KEYS: readonly EvidenceFieldKey[] = [
  'commit',
  'storybook',
  'stagingUrl',
  'productionUrl',
  'astro',
];

const gitTarget = z
  .string()
  .min(1, 'must not be empty')
  .refine(
    (value) =>
      isAbsolute(value) || /^(https?:\/\/|git@|ssh:\/\/)\S+$/.test(value),
    'must be an absolute path or a git url',
  );

export const projectSchema = z.object({
  airtable: z.object({
    baseId: z
      .string()
      .regex(
        /^app[A-Za-z0-9]{14}$/,
        'must look like an Airtable base id, app…',
      ),
    tables: tablesSchema.prefault({}),
    fields: fieldsSchema.prefault({}),
  }),
  asana: z.object({
    workspaceId: z.string().regex(/^\d+$/, 'must be the numeric workspace gid'),
    projectId: z.string().regex(/^\d+$/, 'must be the numeric project gid'),
    // Who each agent is in Asana: a user gid or an email address Asana knows.
    // Absent means the subtask is opened unassigned, for a person to pick up.
    agents: agentsSchema.prefault({}),
  }),
  figma: z
    .object({
      fileKey: z
        .string()
        .regex(/^[A-Za-z0-9]+$/, 'must be a Figma file key')
        .optional(),
    })
    .prefault({}),
  repo: z.object({
    pathOrUrl: gitTarget,
    stagingBranch: name('staging'),
    mainBranch: name('main'),
    // owner/repo, used to confirm a commit resolves. Derived from pathOrUrl
    // when that is a GitHub url, so most people never set it.
    slug: z
      .string()
      .regex(/^[^/\s]+\/[^/\s]+$/, 'must look like owner/repo')
      .optional(),
  }),
  npm: z
    .object({
      registry: z
        .string()
        .regex(/^https?:\/\/\S+$/, 'must be an http or https url')
        .default('https://registry.npmjs.org'),
    })
    .prefault({}),
});

export type ProjectConfig = z.infer<typeof projectSchema>;

/** The top level groups. Seeded before parsing so errors name the leaf. */
export const GROUP_KEYS = Object.keys(
  projectSchema.shape,
) as (keyof ProjectConfig)[];

/** Pull owner/repo out of a GitHub url. Returns undefined for a local path. */
export function slugFromRepo(pathOrUrl: string): string | undefined {
  const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:\/|$)/.exec(
    pathOrUrl,
  );
  if (match?.[1] === undefined || match[2] === undefined) return undefined;
  return `${match[1]}/${match[2]}`;
}
