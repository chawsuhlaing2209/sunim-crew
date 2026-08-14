/**
 * The base does not have what config says it has. The message lists every
 * missing name at once and the config path that sets it, so a person who
 * duplicated the base fixes their map in one pass.
 */
export class SchemaMismatchError extends Error {
  readonly problems: readonly string[];

  constructor(baseId: string, problems: readonly string[]) {
    super(
      [
        `Airtable base ${baseId} is missing what config asks for:`,
        ...problems.map((line) => `  - ${line}`),
        'Rename the field in your base, or point config at the name your base uses. See sunim.config.example.json.',
      ].join('\n'),
    );
    this.name = 'SchemaMismatchError';
    this.problems = problems;
  }
}

/**
 * A write aimed at a formula. This is the wall the whole design leans on:
 * status is derived, so no code path may set it. Throws before any request
 * leaves the process.
 */
export class FormulaFieldWriteError extends Error {
  readonly field: string;

  constructor(field: string, reason: string) {
    super(
      `Refusing to write ${field}: ${reason}. Status is derived from evidence, never written. Write the evidence field instead and let the formula react.`,
    );
    this.name = 'FormulaFieldWriteError';
    this.field = field;
  }
}

/** The Airtable API said no. Carries the status so callers can tell 404 apart. */
export class AirtableRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'AirtableRequestError';
    this.status = status;
  }
}
