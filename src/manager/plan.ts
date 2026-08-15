import type { ComponentRow, DevelopmentStatus } from '../airtable/index.js';
import { extractCommitUrl, extractLink } from './extract.js';
import type { StageAction } from './types.js';

/**
 * What each derived status asks for next, straight from docs/crew.md and the
 * table in docs/asana.md. This is the whole of the manager's judgment, and it
 * is a lookup, not a decision: given a status, one stage, one owner, one piece
 * of evidence to check.
 *
 * Nothing here writes a status. Every entry names an evidence field, and the
 * formula reacts to that field landing.
 */
export const PLAN: Readonly<Partial<Record<DevelopmentStatus, StageAction>>> = {
  'To-do': {
    stage: 'Implementation',
    role: 'Engineer',
    evidence: {
      field: 'commit',
      extract: extractCommitUrl,
      check: (port, claim) => port.commitResolves(claim),
      missing:
        'said it was done but reported no commit URL. A commit URL is the only thing that moves this on.',
    },
  },

  'To be staged': {
    stage: 'Stage',
    role: 'DevOps',
    evidence: {
      field: 'storybook',
      extract: (report) => extractLink(report),
      check: (port, claim) => port.linkLives(claim),
      missing:
        'said it was done but reported no staging link. A link that answers is the only thing that moves this on.',
    },
  },

  'Ready for Testing': {
    stage: 'Test',
    role: 'QA',
    // Testing produces rows, not a field. The formula reads the rows, so the
    // manager has nothing to write, only something to confirm.
    confirm: (port, component) => port.testRowsReal(component.id),
  },

  // One Fix subtask per failed row, each carrying only its own case. The
  // engineer applies the suggestion, and the manager marks the row.
  'To be fixed': {
    stage: 'Fix',
    role: 'Engineer',
    perFailedRow: true,
  },

  // Some rows are marked, some are not. The same work, on what is left.
  Fixing: {
    stage: 'Fix',
    role: 'Engineer',
    perFailedRow: true,
  },

  // Every row is marked Fixed (To re-test). Back to QA, who tests again and
  // writes Passed or Failed, and the formula reads the rows as it always did.
  Fixed: {
    stage: 'Test',
    role: 'QA',
    retest: true,
    confirm: (port, component) => port.testRowsReal(component.id),
  },

  // The one irreversible public step. It waits for a named person, and the
  // deploy runs in the manager rather than in a worker, because a worker
  // would have to be handed the publish key to do it.
  'To be deployed': {
    stage: 'Deploy',
    role: 'DevOps',
    gated: true,
    evidence: {
      field: 'productionUrl',
      extract: (report) => extractLink(report),
      check: (port, claim) => port.linkLives(claim),
      missing:
        'deployed, but reported no production URL. A live URL is the only thing that records this.',
    },
  },

  // Completed is the end. Nothing to do.
};

/**
 * The Document stage. It has no status of its own: a shipped component still
 * reads To be deployed until its page exists, because Completed needs both a
 * production URL and a docs link. So the production URL is what tells these
 * two apart.
 */
export const DOCUMENT_ACTION: StageAction = {
  stage: 'Document',
  role: 'Manager',
  // The page is structurally complete. Whether it is any good is not
  // something a check can answer, and CLAUDE.md says so: the manager checks
  // the page exists and has every section, a person reads the writing.
  signOff:
    'The page is there and every required section is present. That is all this check can tell you. Somebody still has to read it and say whether it is any good, and this component is not really finished until they have.',
  evidence: {
    field: 'astro',
    extract: (report) => extractLink(report),
    check: (port, claim) => port.docsPageComplete(claim),
    missing:
      'wrote the page but reported no URL for it. The page has to be reachable to count.',
  },
};

/**
 * What this component needs next. Takes the row rather than the status,
 * because one status can mean two different things depending on what evidence
 * is already there.
 */
export function actionFor(component: ComponentRow): StageAction | undefined {
  const status = component.status;
  if (status === undefined) return undefined;

  // Shipped, but with no page yet. The formula cannot tell these apart, so
  // the evidence does.
  if (status === 'To be deployed' && component.productionUrl !== undefined) {
    return DOCUMENT_ACTION;
  }

  return PLAN[status];
}
