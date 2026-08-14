import type { AirtableClient, TestRow } from '../airtable/index.js';
import { fail, inconclusive, pass } from './types.js';
import type { Result } from './types.js';

export interface TestRowsOptions {
  /** Fail if there are fewer rows than this. The contract sets the number. */
  readonly expected?: number;
}

/**
 * Are the test rows real. QA reporting "all passed" is a claim; rows in the
 * base with a screenshot on each are the evidence. A row with no attachment
 * is a row nobody looked at, so it does not count.
 */
export async function testRowsReal(
  componentId: string,
  client: AirtableClient,
  options: TestRowsOptions = {},
): Promise<Result> {
  let rows: TestRow[];
  try {
    rows = await client.listTestRows(componentId);
  } catch (error) {
    return inconclusive(`could not read the test rows: ${String(error)}`, {
      componentId,
    });
  }

  if (rows.length === 0) {
    return fail('no test rows exist for this component', { componentId });
  }

  const withoutAttachment = rows
    .filter((row) => row.attachments.length === 0)
    .map((row) => row.name);

  const withoutResult = rows
    .filter((row) => row.result === undefined)
    .map((row) => ({ name: row.name, result: row.resultRaw ?? null }));

  const counts = {
    passed: rows.filter((row) => row.result === 'Passed').length,
    failed: rows.filter((row) => row.result === 'Failed').length,
    toRetest: rows.filter((row) => row.result === 'Fixed (To re-test)').length,
  };

  const seen = {
    componentId,
    rows: rows.length,
    ...counts,
    ...(withoutAttachment.length === 0 ? {} : { withoutAttachment }),
    ...(withoutResult.length === 0 ? {} : { withoutResult }),
  };

  if (withoutAttachment.length > 0) {
    return fail(
      `${withoutAttachment.length} of ${rows.length} test rows have no screenshot`,
      seen,
    );
  }

  if (withoutResult.length > 0) {
    return fail(
      `${withoutResult.length} of ${rows.length} test rows have no result the crew recognises`,
      seen,
    );
  }

  if (options.expected !== undefined && rows.length < options.expected) {
    return fail(
      `${rows.length} test rows, the contract expects ${options.expected}`,
      { ...seen, expected: options.expected },
    );
  }

  return pass(
    `${rows.length} test rows, each with a screenshot: ${counts.passed} passed, ${counts.failed} failed, ${counts.toRetest} to re-test`,
    seen,
  );
}
