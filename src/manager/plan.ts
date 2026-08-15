import type { DevelopmentStatus } from '../airtable/index.js';
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

  'To be deployed': {
    stage: 'Deploy',
    role: 'DevOps',
    deferredTo:
      'step 11, which needs a person to approve before anything ships',
  },

  // Completed is the end. Nothing to do.
};

export function actionFor(
  status: DevelopmentStatus | undefined,
): StageAction | undefined {
  return status === undefined ? undefined : PLAN[status];
}
