export { connect, createClient } from './client.js';
export type { AirtableClient, ClientDeps, EvidencePatch } from './client.js';

export {
  AirtableRequestError,
  FormulaFieldWriteError,
  SchemaMismatchError,
} from './errors.js';

export { airtableGateway, fieldRef, quote } from './gateway.js';
export type { RecordGateway, RecordRow, SelectOptions } from './gateway.js';

export {
  COMPUTED_FIELD_TYPES,
  httpSchemaReader,
  resolveSchema,
} from './schema.js';
export type {
  BaseTable,
  ResolvedField,
  ResolvedSchema,
  ResolvedTable,
  SchemaReader,
} from './schema.js';

export {
  DEVELOPMENT_STATUSES,
  TEST_RESULTS,
  developmentStatusSchema,
  testResultSchema,
} from './types.js';
export type {
  Attachment,
  ComponentRow,
  DevelopmentStatus,
  NewTestRow,
  TestResult,
  TestRow,
  TestRowPatch,
} from './types.js';
