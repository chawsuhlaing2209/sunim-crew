/** Asana said no. Carries the status so a caller can tell 404 from 429. */
export class AsanaRequestError extends Error {
  readonly status: number;
  readonly path: string;

  constructor(status: number, path: string, message: string) {
    super(`Asana ${status} on ${path}: ${message}`);
    this.name = 'AsanaRequestError';
    this.status = status;
    this.path = path;
  }
}

/**
 * Two components claim the same Asana task. The pairing has to be one to one,
 * so this stops rather than guessing which row the task belongs to.
 */
export class TaskKeyConflictError extends Error {
  constructor(
    component: string,
    taskGid: string,
    foundRecordId: string,
    wantedRecordId: string,
  ) {
    super(
      `Asana task ${taskGid} is named "${component}" but is keyed to Airtable row ${foundRecordId}, not ${wantedRecordId}. Rename one of the components, or fix the key block in the task description.`,
    );
    this.name = 'TaskKeyConflictError';
  }
}
