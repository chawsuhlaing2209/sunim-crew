/**
 * The lifecycle, straight from docs/asana.md. One component is one task, each
 * stage is a subtask.
 */
export const LIFECYCLE_STAGES = [
  'Implementation',
  'Stage',
  'Test',
  'Fix',
  'Deploy',
  'Document',
] as const;

export type Stage = (typeof LIFECYCLE_STAGES)[number];

/**
 * The five that always exist. Fix is created one per failed test row, so it
 * is not opened up front. See ensureFixSubtask.
 */
export const STANDING_STAGES: readonly Stage[] = [
  'Implementation',
  'Stage',
  'Test',
  'Deploy',
  'Document',
];

export const AGENT_ROLES = ['Engineer', 'DevOps', 'QA', 'Manager'] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

/** Who owns each stage. */
export const STAGE_ROLE: Readonly<Record<Stage, AgentRole>> = {
  Implementation: 'Engineer',
  Stage: 'DevOps',
  Test: 'QA',
  Fix: 'Engineer',
  Deploy: 'DevOps',
  Document: 'Manager',
};

/**
 * The bar for each stage, written into the subtask so the agent doing the
 * work reads the same definition of done the manager checks against.
 */
export const STAGE_DONE_WHEN: Readonly<Record<Stage, string>> = {
  Implementation:
    'Component built, Storybook previewed, tests pass, commit pushed. Report the commit URL here.',
  Stage:
    'Deployed to staging, staging Storybook link ready. Report the staging link here.',
  Test: 'Every state and prop tested, one row written per case with a screenshot. Report what you wrote here.',
  Fix: 'The specific issue fixed, its row marked Fixed (To re-test). Apply the suggestion, do not re-diagnose.',
  Deploy:
    'Production deployed and the library published, after the human approval. Report the production URL and the npm link here.',
  Document:
    'Astro page written with every required section. Report the page URL here.',
};

/**
 * The manager signs its own comments. readResult skips them, so a refusal the
 * manager wrote is never read back on the next sweep as if a worker had said
 * it. Only what a worker reports counts as a report.
 */
export const MANAGER_MARKER = 'Sunim Crew, manager';

/** One component, as Asana and Airtable both know it. */
export interface ComponentKey {
  /** The component name. This is the task name. */
  readonly component: string;
  /** The Airtable record id. This is what makes the pairing unambiguous. */
  readonly recordId: string;
  /** A link back to the row, so a person reading the task can open it. */
  readonly rowUrl?: string;
}

export interface ComponentTask {
  readonly gid: string;
  readonly name: string;
  readonly key: ComponentKey;
  readonly completed: boolean;
  readonly permalinkUrl: string | undefined;
}

export interface Subtask {
  readonly gid: string;
  readonly parentGid: string | undefined;
  readonly name: string;
  /** The stage this subtask belongs to, read back from its name. */
  readonly stage: Stage | undefined;
  readonly completed: boolean;
  readonly assignee:
    { readonly gid: string; readonly name: string } | undefined;
  readonly notes: string;
  readonly permalinkUrl: string | undefined;
}

/** What an agent wrote into its subtask when it finished. */
export interface AgentReport {
  readonly text: string;
  readonly source: 'comment' | 'notes';
  readonly authorGid: string | undefined;
  readonly authorName: string | undefined;
  readonly createdAt: string | undefined;
}

/** A single failed case, carried into one Fix subtask. */
export interface FixIssue {
  readonly caseName: string;
  readonly expected: string;
  readonly suggestion: string;
}
