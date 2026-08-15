import type {
  AirtableClient,
  ComponentRow,
  TestRow,
} from '../airtable/index.js';
import { MANAGER_MARKER, airtableRowUrl } from '../asana/index.js';
import type { AgentRole, AsanaClient, Stage, Subtask } from '../asana/index.js';
import type { AgentKey, Config } from '../config/index.js';
import type { LaneRun, PreparedCase } from '../lanes/index.js';
import { readApproval } from '../gate/index.js';
import type { ReleaseResult } from '../release/index.js';
import { isInconclusive } from '../verify/index.js';
import type { Evidence, Result } from '../verify/index.js';
import { actionFor } from './plan.js';
import type {
  ComponentOutcome,
  OutcomeKind,
  StageAction,
  SweepReport,
  VerifyPort,
} from './types.js';

/**
 * A lane does the craft for one stage: it spawns a worker and hands back what
 * the worker said. Optional. With no lane wired, the manager opens and assigns
 * the subtask and waits, which is what a person picking up the work needs.
 */
export type Lane = (component: ComponentRow) => Promise<LaneRun>;

/**
 * The fix lane is per case, not per stage: one failed row, one subtask, one
 * worker, one change. It is keyed separately for that reason.
 */
export type FixLane = (
  component: ComponentRow,
  row: TestRow,
) => Promise<LaneRun>;

export interface SweepDeps {
  readonly config: Config;
  readonly airtable: AirtableClient;
  readonly asana: AsanaClient;
  readonly verify: VerifyPort;
  /** Keyed by stage. Only the stages you want run automatically.  */
  readonly lanes?: Partial<Record<Exclude<Stage, 'Fix'>, Lane>>;
  /** Runs one failed case. Separate, because Fix fans out over rows. */
  readonly fixLane?: FixLane;
  /**
   * Deploy production and publish, after a person has approved. Runs in this
   * process, not in a worker: the checklist says only the gated step holds
   * the publish keys, and a spawned worker would have to be given them.
   */
  readonly releaseRun?: (component: ComponentRow) => Promise<ReleaseResult>;
}

const ROLE_TO_AGENT: Readonly<Record<AgentRole, AgentKey>> = {
  Engineer: 'engineer',
  QA: 'qa',
  DevOps: 'devops',
  Manager: 'manager',
};

/** How much of a worker's account of a failure a Fix subtask carries. */
export const FIX_DETAIL_LIMIT = 1500;

const KINDS: readonly OutcomeKind[] = [
  'assigned',
  'waiting',
  'verified',
  'flagged',
  'unverifiable',
  'unreported',
  'unfinished',
  'blocked',
  'awaiting-approval',
  'released',
  'deferred',
  'idle',
];

/**
 * One pass over the board. Reads Airtable, opens and assigns the subtask each
 * component's derived status calls for, and where a worker says it is done,
 * checks what it claimed before writing anything down.
 *
 * Runs once and returns. No loop, no polling, no waiting on anything. A daily
 * routine calls it, and everything it saw is in the report it hands back.
 */
export async function sweep(deps: SweepDeps): Promise<SweepReport> {
  const components = await deps.airtable.listComponents();
  const outcomes: ComponentOutcome[] = [];

  for (const component of components) {
    outcomes.push(await sweepOne(component, deps));
  }

  const counts = Object.fromEntries(
    KINDS.map((kind) => [
      kind,
      outcomes.filter((outcome) => outcome.kind === kind).length,
    ]),
  ) as Record<OutcomeKind, number>;

  return {
    outcomes,
    counts,
    flagged: outcomes.filter((outcome) => outcome.kind === 'flagged'),
  };
}

async function sweepOne(
  component: ComponentRow,
  deps: SweepDeps,
): Promise<ComponentOutcome> {
  const base = {
    component: component.name,
    recordId: component.id,
    status: component.status,
    stage: undefined,
    role: undefined,
    taskGid: undefined,
    subtaskGid: undefined,
    wrote: undefined,
    evidence: undefined,
  } as const;

  const action = actionFor(component);

  if (action === undefined) {
    return {
      ...base,
      kind: component.status === 'Completed' ? 'idle' : 'deferred',
      note:
        component.status === 'Completed'
          ? 'completed, nothing to do'
          : `no action for status ${String(component.statusRaw ?? 'unknown')}`,
    };
  }

  if (action.deferredTo !== undefined) {
    return {
      ...base,
      kind: 'deferred',
      stage: action.stage,
      role: action.role,
      note: `${String(component.status)} is handled by ${action.deferredTo}`,
    };
  }

  // One component, one task, keyed by the Airtable row.
  const task = await deps.asana.ensureComponentTask({
    component: component.name,
    recordId: component.id,
    rowUrl: airtableRowUrl(
      deps.config.airtable.baseId,
      deps.airtable.schema.tables.components.id,
      component.id,
    ),
  });

  const assignee = deps.config.asana.agents[ROLE_TO_AGENT[action.role]];

  // A status that is one subtask per failed case rather than one per stage.
  if (action.perFailedRow === true) {
    return await sweepFixes(component, action, task.gid, base, deps);
  }

  if (action.stage === 'Fix') {
    return {
      ...base,
      kind: 'deferred',
      note: 'a Fix stage only ever runs one case at a time',
    };
  }

  const stage = action.stage;
  const existing = (await deps.asana.listSubtasks(task.gid)).find(
    (subtask) => subtask.name === stage,
  );

  const subtask = await deps.asana.ensureSubtask(task.gid, stage, {
    ...(assignee === undefined ? {} : { assignee }),
  });

  const opened = existing === undefined;
  const shared = {
    ...base,
    stage,
    role: action.role,
    taskGid: task.gid,
    subtaskGid: subtask.gid,
  } as const;

  // The human gate. Nothing below this line runs until a named person has
  // approved this exact commit.
  if (action.gated === true && !subtask.completed) {
    const verdict = await readApproval(component, subtask.gid, {
      asana: deps.asana,
      approvers: deps.config.approvers,
    });

    if (!verdict.approved) {
      return {
        ...shared,
        kind: 'awaiting-approval',
        note: `not deploying: ${verdict.reason}`,
      };
    }

    if (deps.releaseRun === undefined) {
      return {
        ...shared,
        kind: 'awaiting-approval',
        note: `${verdict.reason}, but no release is wired into this sweep`,
      };
    }

    const shipped = await deps.releaseRun(component);

    await deps.asana.reportOnSubtask(
      subtask.gid,
      [
        `${MANAGER_MARKER}, release`,
        '',
        `Approved by ${verdict.approval.by} for ${verdict.approval.commit}.`,
        ...shipped.steps.map(
          (step) =>
            `${step.name}: ${step.ok ? 'ok' : 'failed'} (${step.command})`,
        ),
        shipped.productionUrl === undefined
          ? 'No production URL.'
          : `Production: ${shipped.productionUrl}`,
        shipped.npmUrl === undefined
          ? 'No npm link.'
          : `npm: ${shipped.npmUrl}`,
      ].join('\n'),
    );

    if (!shipped.ok) {
      return {
        ...shared,
        kind: 'unfinished',
        note: `${verdict.reason}, but ${shipped.error ?? 'the release failed'}`,
      };
    }

    // Verified like anything else: the URL has to answer before it is
    // written, approval or no approval.
    const claim = shipped.productionUrl;
    if (claim === undefined) {
      return {
        ...shared,
        kind: 'unreported',
        note: 'released, but no production URL came back, so nothing was written',
      };
    }

    const lives = await deps.verify.linkLives(claim);
    if (!lives.ok) {
      return await refuse(action, subtask, shared, lives, deps, claim);
    }

    await deps.airtable.writeEvidence(component.id, { productionUrl: claim });
    await deps.asana.completeSubtask(subtask.gid);

    return {
      ...shared,
      kind: 'released',
      wrote: 'productionUrl',
      evidence: lives.evidence,
      note: `${verdict.reason}, deployed and published. Wrote productionUrl: ${lives.evidence.summary}`,
    };
  }

  let current = subtask;

  // The stage ran before and has to run again. Every row is marked fixed, so
  // the Test subtask goes back to QA rather than being read as still done.
  if (action.retest === true && current.completed) {
    current = await deps.asana.reopenSubtask(current.gid);
    if (assignee !== undefined) {
      current = await deps.asana.assignSubtask(current.gid, assignee);
    }
  }

  if (!current.completed) {
    const lane = deps.lanes?.[stage];

    if (lane === undefined) {
      return {
        ...shared,
        kind: opened ? 'assigned' : 'waiting',
        note: opened
          ? `opened ${stage} for the ${action.role}${assignee === undefined ? ', unassigned' : ''}`
          : `${stage} is with the ${action.role}, not done yet`,
      };
    }

    // Run the craft. The worker reports; it writes nothing anywhere.
    const run = await lane(component);

    if (run.report.trim() !== '') {
      await deps.asana.reportOnSubtask(
        current.gid,
        [`${action.role}, via the crew`, '', run.report.trim()].join('\n'),
      );
    }

    // The worker says the component itself is what broke. That is not a
    // failure of this stage, it is work for whoever built it, so a Fix
    // subtask opens carrying what the worker saw. This stage stays open and
    // is picked up again once the fix lands.
    if (run.blocked?.belongsToComponent === true) {
      const fix = await deps.asana.ensureFixSubtask(
        task.gid,
        {
          caseName: `${stage} build`,
          expected: `${component.name} builds and reaches ${deps.config.repo.stagingBranch}`,
          suggestion: run.blocked.reason.slice(0, FIX_DETAIL_LIMIT),
        },
        {
          ...(deps.config.asana.agents.engineer === undefined
            ? {}
            : { assignee: deps.config.asana.agents.engineer }),
        },
      );

      return {
        ...shared,
        kind: 'blocked',
        note: `${run.note}. Opened ${fix.name} for the Engineer.`,
      };
    }

    if (!run.ok) {
      return { ...shared, kind: 'unfinished', note: run.note };
    }

    // A lane that produced rows it cannot write itself. QA has no Airtable
    // access on purpose, so this is where its cases become records, and the
    // screenshots become the attachments that make them count.
    if (run.cases !== undefined && run.cases.length > 0) {
      const written = await recordCases(component, run.cases, deps);
      if (written.problems.length > 0) {
        return {
          ...shared,
          kind: 'unfinished',
          note: `${run.note}, but ${written.problems.join('; ')}`,
        };
      }
    }

    // It says it is done, so the subtask says so too. Whether it is true is
    // the next thing this function finds out.
    current = await deps.asana.completeSubtask(current.gid);
  }

  return await check(component, action, current, shared, deps);
}

/**
 * One Fix subtask per failed row, each carrying only its own case.
 *
 * The engineer applies the suggestion and reports. It cannot mark the row,
 * and that is the point: a worker that could mark its own case fixed could
 * mark every case fixed, and the retest would be checking nothing. So the
 * manager marks the row, once the worker has actually run and reported.
 */
async function sweepFixes(
  component: ComponentRow,
  action: StageAction,
  taskGid: string,
  base: Omit<ComponentOutcome, 'kind' | 'note'>,
  deps: SweepDeps,
): Promise<ComponentOutcome> {
  const rows = await deps.airtable.listTestRows(component.id);
  const failed = rows.filter((row) => row.result === 'Failed');
  const assignee = deps.config.asana.agents.engineer;

  const shared = {
    ...base,
    stage: 'Fix' as const,
    role: action.role,
    taskGid,
  };

  if (failed.length === 0) {
    const waiting = rows.filter(
      (row) => row.result === 'Fixed (To re-test)',
    ).length;
    return {
      ...shared,
      kind: 'waiting',
      note: `${waiting} of ${rows.length} cases are fixed and waiting to be retested`,
    };
  }

  const fixed: string[] = [];
  const notes: string[] = [];

  for (const row of failed) {
    // Only the case name, the expected result and the suggestion travel.
    const subtask = await deps.asana.ensureFixSubtask(
      taskGid,
      {
        caseName: row.name,
        expected: row.expected ?? 'not recorded',
        suggestion: row.suggestion ?? 'not recorded',
      },
      { ...(assignee === undefined ? {} : { assignee }) },
    );

    if (subtask.completed) continue;
    if (deps.fixLane === undefined) {
      notes.push(`"${row.name}" is with the Engineer`);
      continue;
    }

    const run = await deps.fixLane(component, row);

    if (run.report.trim() !== '') {
      await deps.asana.reportOnSubtask(
        subtask.gid,
        ['Engineer, via the crew', '', run.report.trim()].join('\n'),
      );
    }

    if (!run.ok) {
      notes.push(run.note);
      continue;
    }

    // The worker did the work and said so. Now, and only now, the row moves
    // to Fixed (To re-test), and the formula reads that on its own.
    await deps.airtable.updateTestRow(row.id, { result: 'Fixed (To re-test)' });
    await deps.asana.completeSubtask(subtask.gid);
    fixed.push(row.name);
  }

  const note = [
    `${failed.length} failed cases`,
    fixed.length > 0 ? `${fixed.length} marked fixed to re-test` : undefined,
    ...notes,
  ]
    .filter((line): line is string => line !== undefined)
    .join(', ');

  return {
    ...shared,
    kind: fixed.length > 0 ? 'verified' : 'waiting',
    note,
  };
}

/**
 * Put QA's cases into the base, one row each, with its screenshot attached.
 *
 * A case whose screenshot is missing is written anyway, and the missing file
 * is reported: testRowsReal then refuses the whole set, which is the right
 * outcome. Nothing here decides anything, it only records what QA saw.
 */
export async function recordCases(
  component: ComponentRow,
  cases: readonly PreparedCase[],
  deps: SweepDeps,
): Promise<{ written: number; problems: string[] }> {
  const problems: string[] = [];

  // A case the base already holds is updated, not written again. That is
  // what a retest is: the same case, looked at a second time.
  const existing = new Map(
    (await deps.airtable.listTestRows(component.id)).map((row) => [
      row.name,
      row,
    ]),
  );

  const fresh = cases.filter((entry) => !existing.has(entry.row.name));
  const seen = cases.filter((entry) => existing.has(entry.row.name));

  for (const entry of seen) {
    const row = existing.get(entry.row.name);
    if (row === undefined) continue;
    await deps.airtable.updateTestRow(row.id, {
      result: entry.row.result,
      ...(entry.row.expected === undefined
        ? {}
        : { expected: entry.row.expected }),
      ...(entry.row.suggestion === undefined
        ? {}
        : { suggestion: entry.row.suggestion }),
    });
    try {
      await deps.airtable.attachToTestRow(row.id, entry.screenshotPath);
    } catch (error) {
      problems.push(
        `the screenshot for "${entry.row.name}" did not attach: ${String(error)}`,
      );
    }
  }

  if (fresh.length === 0) return { written: seen.length, problems };

  const rows = await deps.airtable.createTestRows(
    component.id,
    fresh.map((entry) => entry.row),
  );

  for (const [index, row] of rows.entries()) {
    const source = fresh[index];
    if (source === undefined) continue;
    try {
      await deps.airtable.attachToTestRow(row.id, source.screenshotPath);
    } catch (error) {
      problems.push(
        `the screenshot for "${source.row.name}" did not attach: ${String(error)}`,
      );
    }
  }

  return { written: rows.length + seen.length, problems };
}

/**
 * The subtask says done. This is the only place evidence is written, and it
 * is written only after the claim has been checked.
 */
async function check(
  component: ComponentRow,
  action: StageAction,
  subtask: Subtask,
  shared: Omit<ComponentOutcome, 'kind' | 'note'>,
  deps: SweepDeps,
): Promise<ComponentOutcome> {
  const report = await deps.asana.readResult(subtask.gid);

  // A stage that produces rows rather than a field, so nothing is written.
  if (action.confirm !== undefined) {
    const result = await action.confirm(deps.verify, component);
    if (result.ok) {
      return {
        ...shared,
        kind: 'verified',
        evidence: result.evidence,
        note: `${action.stage} confirmed: ${result.evidence.summary}`,
      };
    }
    return await refuse(action, subtask, shared, result, deps);
  }

  const evidence = action.evidence;
  if (evidence === undefined) {
    return { ...shared, kind: 'waiting', note: 'nothing to check' };
  }

  const claim =
    report === undefined ? undefined : evidence.extract(report.text);

  if (claim === undefined) {
    const note = `${action.role} ${evidence.missing}`;
    await deps.asana.reportOnSubtask(subtask.gid, managerNote(note));
    await deps.asana.reopenSubtask(subtask.gid);
    return { ...shared, kind: 'unreported', note };
  }

  const result = await evidence.check(deps.verify, claim);

  if (!result.ok) {
    return await refuse(action, subtask, shared, result, deps, claim);
  }

  // Verified. Now, and only now, the evidence field is written, and the
  // formula moves the component on its own.
  await deps.airtable.writeEvidence(component.id, {
    [evidence.field]: claim,
  });

  if (action.signOff !== undefined) {
    await deps.asana.reportOnSubtask(
      subtask.gid,
      [MANAGER_MARKER, '', action.signOff].join('\n'),
    );
  }

  return {
    ...shared,
    kind: 'verified',
    wrote: evidence.field,
    evidence: result.evidence,
    note: `wrote ${evidence.field}: ${result.evidence.summary}`,
  };
}

/**
 * The claim did not hold up. Nothing is written to Airtable, so the status
 * cannot move. The worker is told what failed, on its own subtask, and the
 * subtask goes back to open because the work is not finished.
 *
 * A check that could not reach a verdict is different: the worker may well
 * have done the job, and our side is the part that broke. That is left alone
 * for the next sweep rather than held against anyone.
 */
async function refuse(
  action: StageAction,
  subtask: Subtask,
  shared: Omit<ComponentOutcome, 'kind' | 'note'>,
  result: Result,
  deps: SweepDeps,
  claim?: string,
): Promise<ComponentOutcome> {
  const summary = result.evidence.summary;

  if (isInconclusive(result)) {
    return {
      ...shared,
      kind: 'unverifiable',
      evidence: result.evidence,
      note: `could not check ${action.stage}: ${summary}. Leaving it for the next sweep.`,
    };
  }

  const note =
    claim === undefined
      ? `${action.stage} reported done, but the check failed: ${summary}`
      : `${action.stage} reported done with ${claim}, but the check failed: ${summary}`;

  await deps.asana.reportOnSubtask(subtask.gid, managerNote(note));
  await deps.asana.reopenSubtask(subtask.gid);

  return { ...shared, kind: 'flagged', evidence: result.evidence, note };
}

function managerNote(note: string): string {
  return [
    MANAGER_MARKER,
    '',
    note,
    '',
    'Nothing was written to Airtable, so the status has not moved. This subtask is open again.',
  ].join('\n');
}

/** A short, readable account of one sweep, for a log or a person. */
export function describeSweep(report: SweepReport): string {
  const lines = [
    `${report.outcomes.length} ${report.outcomes.length === 1 ? 'component' : 'components'}: ${KINDS.filter(
      (kind) => report.counts[kind] > 0,
    )
      .map((kind) => `${report.counts[kind]} ${kind}`)
      .join(', ')}`,
  ];

  for (const outcome of report.outcomes) {
    lines.push(
      `  ${outcome.kind.padEnd(12)} ${outcome.component}: ${outcome.note}`,
    );
  }

  return lines.join('\n');
}

/** Kept so a caller can build the evidence view without importing verify. */
export type { Evidence };
