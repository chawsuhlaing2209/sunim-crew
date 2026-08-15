import type { ComponentRow } from '../airtable/index.js';
import type { AgentReport, AsanaClient } from '../asana/index.js';

/**
 * The human gate.
 *
 * A person approves by leaving this on the component's Deploy subtask. Two
 * ways in, one record: `npm run approve` posts it with the operator's own
 * Asana token, or a person types it in Asana. Either way Asana records who
 * wrote it, and that is the part that matters.
 */
export const APPROVAL_MARKER = 'APPROVED FOR PRODUCTION';

export function renderApproval(component: string, commit: string): string {
  return [
    APPROVAL_MARKER,
    `component: ${component}`,
    `commit: ${commit}`,
    '',
    'This approves deploying this component to production and publishing the',
    'library. It is tied to the commit above: change the code and this lapses.',
  ].join('\n');
}

export interface ApprovalClaim {
  readonly component: string;
  readonly commit: string;
}

export function parseApproval(text: string): ApprovalClaim | undefined {
  if (!text.includes(APPROVAL_MARKER)) return undefined;

  const read = (label: string): string | undefined => {
    const match = new RegExp(`^${label}:\\s*(.+)$`, 'm').exec(text);
    const value = match?.[1]?.trim();
    return value === undefined || value === '' ? undefined : value;
  };

  const component = read('component');
  const commit = read('commit');
  return component === undefined || commit === undefined
    ? undefined
    : { component, commit };
}

export interface Approval {
  readonly component: string;
  readonly commit: string;
  readonly by: string;
  readonly at: string | undefined;
}

export type GateVerdict =
  | {
      readonly approved: true;
      readonly approval: Approval;
      readonly reason: string;
    }
  | { readonly approved: false; readonly reason: string };

/** An approver named by gid, or by the name Asana shows. */
export function isNamedApprover(
  report: AgentReport,
  approvers: readonly string[],
): boolean {
  const names = approvers.map((entry) => entry.trim().toLowerCase());
  const gid = report.authorGid?.trim().toLowerCase();
  const name = report.authorName?.trim().toLowerCase();

  return names.some((entry) => entry === gid || entry === name);
}

export interface GateDeps {
  readonly asana: AsanaClient;
  readonly approvers: readonly string[];
}

/**
 * Has a person approved this component, and is that approval still good?
 *
 * Four ways to fail, each with its own answer, because "not approved" and
 * "approved by somebody who may not approve" and "approved, but for code that
 * has since changed" are three different situations and the log should say
 * which one it is.
 */
export async function readApproval(
  component: ComponentRow,
  deploySubtaskGid: string,
  deps: GateDeps,
): Promise<GateVerdict> {
  if (deps.approvers.length === 0) {
    return {
      approved: false,
      reason:
        'nobody is listed as an approver, so nothing can be approved. Set approvers in config.',
    };
  }

  if (component.commit === undefined) {
    return {
      approved: false,
      reason:
        'the component has no commit recorded, so there is nothing to approve',
    };
  }

  const comments = await deps.asana.listComments(deploySubtaskGid);
  const claims = comments
    .map((comment) => ({ comment, claim: parseApproval(comment.text) }))
    .filter(
      (entry): entry is { comment: AgentReport; claim: ApprovalClaim } =>
        entry.claim !== undefined,
    );

  if (claims.length === 0) {
    return { approved: false, reason: 'waiting for a person to approve' };
  }

  // The newest approval wins, so a later one can supersede an earlier one.
  const latest = claims[claims.length - 1];
  if (latest === undefined) {
    return { approved: false, reason: 'waiting for a person to approve' };
  }

  const { comment, claim } = latest;

  if (!isNamedApprover(comment, deps.approvers)) {
    return {
      approved: false,
      reason: `${comment.authorName ?? comment.authorGid ?? 'somebody'} approved it, and is not a named approver. Nothing ships on that.`,
    };
  }

  // Tied to the commit. Approving one thing and shipping another is exactly
  // what a gate is supposed to stop.
  if (claim.commit.trim() !== component.commit.trim()) {
    return {
      approved: false,
      reason: `the approval is for ${claim.commit}, but the component is now at ${component.commit}. It has changed since, so the approval has lapsed and somebody has to look again.`,
    };
  }

  return {
    approved: true,
    approval: {
      component: claim.component,
      commit: claim.commit,
      by: comment.authorName ?? comment.authorGid ?? 'unknown',
      at: comment.createdAt,
    },
    reason: `approved by ${comment.authorName ?? comment.authorGid ?? 'unknown'} for ${claim.commit.slice(0, 40)}`,
  };
}
