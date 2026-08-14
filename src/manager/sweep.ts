import type { AirtableClient, ComponentRow } from '../airtable/index.js';
import { airtableRowUrl } from '../asana/index.js';
import type { AgentRole, AsanaClient, Subtask } from '../asana/index.js';
import type { AgentKey, Config } from '../config/index.js';
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

export interface SweepDeps {
  readonly config: Config;
  readonly airtable: AirtableClient;
  readonly asana: AsanaClient;
  readonly verify: VerifyPort;
}

const ROLE_TO_AGENT: Readonly<Record<AgentRole, AgentKey>> = {
  Engineer: 'engineer',
  QA: 'qa',
  DevOps: 'devops',
  Manager: 'manager',
};

const KINDS: readonly OutcomeKind[] = [
  'assigned',
  'waiting',
  'verified',
  'flagged',
  'unverifiable',
  'unreported',
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

  const action = actionFor(component.status);

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
  const existing = (await deps.asana.listSubtasks(task.gid)).find(
    (subtask) => subtask.name === action.stage,
  );

  const subtask = await deps.asana.ensureSubtask(task.gid, action.stage, {
    ...(assignee === undefined ? {} : { assignee }),
  });

  const opened = existing === undefined;
  const shared = {
    ...base,
    stage: action.stage,
    role: action.role,
    taskGid: task.gid,
    subtaskGid: subtask.gid,
  } as const;

  if (!subtask.completed) {
    return {
      ...shared,
      kind: opened ? 'assigned' : 'waiting',
      note: opened
        ? `opened ${action.stage} for the ${action.role}${assignee === undefined ? ', unassigned' : ''}`
        : `${action.stage} is with the ${action.role}, not done yet`,
    };
  }

  return await check(component, action, subtask, shared, deps);
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
    'Sunim Crew, manager',
    '',
    note,
    '',
    'Nothing was written to Airtable, so the status has not moved. This subtask is open again.',
  ].join('\n');
}

/** A short, readable account of one sweep, for a log or a person. */
export function describeSweep(report: SweepReport): string {
  const lines = [
    `${report.outcomes.length} components: ${KINDS.filter(
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
