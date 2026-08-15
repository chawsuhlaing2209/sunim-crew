import { z } from 'zod';

/**
 * The derived stages, exactly as the Development formula computes them.
 * Nothing here is ever written. The crew reads this and acts.
 */
export const DEVELOPMENT_STATUSES = [
  'To-do',
  'To be staged',
  'Ready for Testing',
  'To be fixed',
  'Fixing',
  'Fixed',
  'To be deployed',
  'Completed',
] as const;

export const developmentStatusSchema = z.enum(DEVELOPMENT_STATUSES);
export type DevelopmentStatus = (typeof DEVELOPMENT_STATUSES)[number];

/** What a Storybook Testing row can say about one case. */
export const TEST_RESULTS = ['Passed', 'Failed', 'Fixed (To re-test)'] as const;

export const testResultSchema = z.enum(TEST_RESULTS);
export type TestResult = (typeof TEST_RESULTS)[number];

export interface Attachment {
  readonly id: string;
  readonly url: string;
  readonly filename: string;
}

/** A component, as the crew reads it. */
export interface ComponentRow {
  readonly id: string;
  readonly name: string;
  /** Derived by the formula. Undefined when the base says something new. */
  readonly status: DevelopmentStatus | undefined;
  /** What the formula actually returned, for the log when status is undefined. */
  readonly statusRaw: string | undefined;
  readonly figma: string | undefined;
  readonly design: string | undefined;
  readonly commit: string | undefined;
  readonly storybook: string | undefined;
  readonly stagingUrl: string | undefined;
  readonly productionUrl: string | undefined;
  readonly astro: string | undefined;
  readonly totalTests: number | undefined;
  readonly passedTests: number | undefined;
  readonly synchronization: number | undefined;
}

/** One test case against one component. */
export interface TestRow {
  readonly id: string;
  readonly name: string;
  readonly result: TestResult | undefined;
  readonly resultRaw: string | undefined;
  readonly expected: string | undefined;
  readonly suggestion: string | undefined;
  readonly componentIds: readonly string[];
  readonly attachments: readonly Attachment[];
}

export interface NewTestRow {
  readonly name: string;
  readonly result: TestResult;
  /** What the case should have done. QA fills this in on a failure. */
  readonly expected?: string;
  /** What to change. The engineer applies it without re-diagnosing. */
  readonly suggestion?: string;
}

export interface TestRowPatch {
  readonly name?: string;
  readonly result?: TestResult;
  readonly expected?: string;
  readonly suggestion?: string;
}
