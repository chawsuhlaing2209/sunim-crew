/**
 * The verify layer. Pure checks, no model anywhere near them: each one takes
 * a claim and goes and looks. The manager calls these before it writes an
 * evidence field, which is what keeps the Airtable formula honest. A worker
 * can say anything it likes; only what survives this gets written down.
 */
export { commitResolves, parseCommitUrl } from './commit.js';
export type { CommitTarget } from './commit.js';

export { linkLives, readPage } from './link.js';
export type { LinkResponse } from './link.js';

export { testRowsReal } from './test-rows.js';
export type { TestRowsOptions } from './test-rows.js';

export { REQUIRED_SECTIONS, docsPageComplete, headings } from './docs.js';
export type { SectionKey } from './docs.js';

export { SCANNED_EXTENSIONS, findHex, tokenClean } from './tokens.js';
export type { HexFinding } from './tokens.js';

export { contractSchema, contractValid, parseJsonc } from './contract.js';
export type { Contract } from './contract.js';

export { fail, inconclusive, isInconclusive, pass } from './types.js';
export type { Evidence, FetchDeps, Result } from './types.js';
