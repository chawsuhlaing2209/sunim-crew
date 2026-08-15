import type { EvidenceFieldKey } from '../config/index.js';
import type { ComponentRow, DevelopmentStatus } from '../airtable/index.js';
import type { AgentRole, Stage } from '../asana/index.js';
import type { Evidence, Result } from '../verify/index.js';

/** What the manager did about one component in one sweep. */
export type OutcomeKind =
  /** Opened or assigned the subtask. The work has not started. */
  | 'assigned'
  /** The subtask is open and not done. Nothing to do but wait. */
  | 'waiting'
  /** Reported done, evidence checked, evidence written. */
  | 'verified'
  /** Reported done, evidence checked, evidence false. Nothing written. */
  | 'flagged'
  /** Reported done, and the check could not reach a verdict. Retry next sweep. */
  | 'unverifiable'
  /** Reported done and said nothing the manager could check. */
  | 'unreported'
  /** A worker ran and did not finish. Nothing to check, nothing written. */
  | 'unfinished'
  /** A worker stopped because the component is broken. A Fix subtask is open. */
  | 'blocked'
  /** This status is handled by a step that is not built yet. */
  | 'deferred'
  /** Nothing for the crew to do. */
  | 'idle';

export interface ComponentOutcome {
  readonly component: string;
  readonly recordId: string;
  readonly status: DevelopmentStatus | undefined;
  readonly kind: OutcomeKind;
  readonly stage: Stage | undefined;
  readonly role: AgentRole | undefined;
  readonly taskGid: string | undefined;
  readonly subtaskGid: string | undefined;
  /** The field written, on a verified outcome. Never a formula field. */
  readonly wrote: EvidenceFieldKey | undefined;
  /** What the check saw, kept whether it passed or failed. */
  readonly evidence: Evidence | undefined;
  /** One line, for the log and for a person reading the sweep. */
  readonly note: string;
}

export interface SweepReport {
  readonly outcomes: readonly ComponentOutcome[];
  readonly counts: Readonly<Record<OutcomeKind, number>>;
  /** Components whose worker claimed something that is not true. */
  readonly flagged: readonly ComponentOutcome[];
}

/**
 * The checks the manager runs before it writes anything. A seam, so the
 * manager can be tested without a network and without a base.
 */
export interface VerifyPort {
  commitResolves(url: string): Promise<Result>;
  linkLives(url: string): Promise<Result>;
  testRowsReal(componentId: string): Promise<Result>;
  docsPageComplete(url: string): Promise<Result>;
}

export interface StageEvidence {
  /** The Airtable field this stage's evidence lands in. */
  readonly field: EvidenceFieldKey;
  /** Pull the claim out of what the worker wrote. */
  readonly extract: (report: string) => string | undefined;
  /** Go and check the claim. */
  readonly check: (port: VerifyPort, claim: string) => Promise<Result>;
  /** What to say when the worker reported nothing checkable. */
  readonly missing: string;
}

/** What one derived status asks the manager to do next. */
export interface StageAction {
  readonly stage: Exclude<Stage, 'Fix'>;
  readonly role: AgentRole;
  /** The evidence this stage produces, when it produces a field. */
  readonly evidence?: StageEvidence;
  /**
   * A check with no field behind it. Testing writes rows, and the formula
   * reads the rows, so there is nothing for the manager to write. It still
   * has to confirm the rows are real before it believes QA is finished.
   */
  readonly confirm?: (
    port: VerifyPort,
    component: ComponentRow,
  ) => Promise<Result>;
  /** Set when a later step owns this status. */
  readonly deferredTo?: string;
}
