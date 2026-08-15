import { z } from 'zod';
import { isAbsolute } from 'node:path';

/**
 * The project shape: everything specific to a base, a workspace, a repo.
 * Names, not ids. A duplicated Airtable base keeps the names and gets new
 * ids, so the crew addresses the base by name and resolves ids at startup.
 * The defaults below describe the shipped base template. Point the crew at a
 * base with different names by editing the map, not the code.
 */

/** The only values with a fallback. Declared once, used by the schema below. */
export const DEFAULTS = {
  NPM_REGISTRY: 'https://registry.npmjs.org',
  // Figma's hosted MCP server. A team running the Figma desktop app can point
  // this at the local Dev Mode server instead, normally
  // http://127.0.0.1:3845/mcp
  FIGMA_MCP_URL: 'https://mcp.figma.com/mcp',
} as const;

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
  expectedResults: name('Expected Results'),
  suggestion: name('Suggestion for Improvement'),
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
  expectedResults: 'tests',
  suggestion: 'tests',
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
      mcpUrl: z
        .string()
        .regex(/^https?:\/\/\S+$/, 'must be an http or https url')
        .default(DEFAULTS.FIGMA_MCP_URL),
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
    // How this repo puts a branch on staging. Left unset, DevOps reads the
    // repo's own scripts and CI config to find the path, and says so if the
    // repo has none.
    stageCommand: z.string().min(1).optional(),
    // How this repo deploys production. Run by the gated step, never by a
    // worker. With no command, nothing can be deployed, which is the safe
    // way round for a value nobody has set yet.
    productionCommand: z.string().min(1).optional(),
    // Where a component lives in production. {slug} is the component slug.
    // Left unset, the production URL is read out of the deploy output.
    productionUrlTemplate: z.string().min(1).optional(),
  }),
  npm: z
    .object({
      registry: z
        .string()
        .regex(/^https?:\/\/\S+$/, 'must be an http or https url')
        .default(DEFAULTS.NPM_REGISTRY),
      publishCommand: name('npm publish'),
    })
    .prefault({}),
  /** The Astro Starlight site the component pages live in. */
  docs: z
    .object({
      // Where a component page is written, absolute or relative to the repo.
      path: z.string().min(1).optional(),
      // Where that page appears once the site is built. {slug} is the slug.
      urlTemplate: z
        .string()
        .regex(/^https?:\/\/\S+$/, 'must be an http or https url')
        .optional(),
      // How the docs site is built and published, when it has its own path.
      deployCommand: z.string().min(1).optional(),
    })
    .prefault({}),
  /**
   * What a worker is allowed to be and how long it gets.
   *
   * Mostly here for a subscription. A plan has a window rather than a
   * balance, so the thing worth controlling is not price per token but how
   * much of somebody's afternoon one delegation can take, and which model
   * spends that window fastest.
   */
  worker: z
    .object({
      /**
       * Which meter a worker spends.
       *
       * "subscription", the default, means a worker is given no API key at
       * all and authenticates the way the person running the sweep does.
       * "api-key" hands it ANTHROPIC_API_KEY and bills the console account.
       *
       * The default is the safe one, because the failure it prevents is
       * silent: a key sitting in a .env or exported in a shell would
       * otherwise put every worker on metered billing without anybody
       * choosing it.
       */
      auth: z.enum(['subscription', 'api-key']).default('subscription'),
      // A model alias, "sonnet" or "opus", or a full name. The CLI's own
      // default when unset, which follows whatever the operator is on.
      model: z.string().min(1).optional(),
      // A ceiling on every delegation, in minutes. Each lane has its own,
      // sized to its craft; this lowers any that are longer and raises none.
      maxMinutes: z.coerce.number().int().positive().max(240).optional(),
    })
    .prefault({}),
  /**
   * Who may approve a production deploy. An Asana user gid, or the name
   * Asana shows. Nobody listed means nothing can ever be approved, which is
   * the safe way round.
   */
  approvers: z.array(z.string().min(1)).prefault([]),
});

export type ProjectConfig = z.infer<typeof projectSchema>;

/**
 * The top level groups, seeded before parsing so a missing value is reported
 * at its leaf. Listed rather than derived, because approvers is a list and
 * seeding it with an object would break it.
 */
export const GROUP_KEYS = [
  'airtable',
  'asana',
  'figma',
  'repo',
  'npm',
  'docs',
  'worker',
] as const satisfies readonly (keyof ProjectConfig)[];

/** Pull owner/repo out of a GitHub url. Returns undefined for a local path. */
export function slugFromRepo(pathOrUrl: string): string | undefined {
  const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:\/|$)/.exec(
    pathOrUrl,
  );
  if (match?.[1] === undefined || match[2] === undefined) return undefined;
  return `${match[1]}/${match[2]}`;
}
