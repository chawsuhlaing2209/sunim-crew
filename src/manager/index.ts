import type { AirtableClient } from '../airtable/index.js';
import type { Config } from '../config/index.js';
import {
  commitResolves,
  docsPageComplete,
  linkLives,
  testRowsReal,
} from '../verify/index.js';
import type { VerifyPort } from './types.js';

export { PLAN, actionFor } from './plan.js';
export {
  FIX_DETAIL_LIMIT,
  describeSweep,
  recordCases,
  sweep,
} from './sweep.js';
export { extractCommitUrl, extractLink, urlsIn } from './extract.js';
export type { FixLane, Lane, SweepDeps } from './sweep.js';
export * from '../gate/index.js';
export { release } from '../release/index.js';
export type {
  ComponentOutcome,
  OutcomeKind,
  StageAction,
  StageEvidence,
  SweepReport,
  VerifyPort,
} from './types.js';

/**
 * The real checks, wired to the GitHub token and the base. Handed to sweep()
 * as one object so a test can pass a different one and never touch a network.
 */
export function verifyPort(
  config: Config,
  airtable: AirtableClient,
): VerifyPort {
  return {
    commitResolves: (url) => commitResolves(url, config.github.token),
    linkLives: (url) => linkLives(url),
    testRowsReal: (componentId) => testRowsReal(componentId, airtable),
    docsPageComplete: (url) => docsPageComplete(url),
  };
}
