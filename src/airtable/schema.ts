import { z } from 'zod';
import {
  FIELD_KEYS,
  FIELD_TABLE,
  FORMULA_FIELD_KEYS,
  TABLE_KEYS,
} from '../config/index.js';
import type { Config, FieldKey, TableKey } from '../config/index.js';
import { AirtableRequestError, SchemaMismatchError } from './errors.js';

/**
 * Field types Airtable computes for you. A write to one is always refused,
 * whatever config calls it. This is a second lock on the same door as
 * FORMULA_FIELD_KEYS: that list is what we know, this is what the base says.
 */
export const COMPUTED_FIELD_TYPES: ReadonlySet<string> = new Set([
  'formula',
  'rollup',
  'count',
  'autoNumber',
  'createdTime',
  'lastModifiedTime',
  'createdBy',
  'lastModifiedBy',
  'multipleLookupValues',
  'button',
]);

const fieldSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
});

const tableSchema = z.object({
  id: z.string(),
  name: z.string(),
  primaryFieldId: z.string(),
  fields: z.array(fieldSchema),
});

const metaResponseSchema = z.object({ tables: z.array(tableSchema) });

export type BaseTable = z.infer<typeof tableSchema>;

/** One resolved field: what config calls it, what the base calls it. */
export interface ResolvedField {
  readonly key: FieldKey;
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly computed: boolean;
}

export interface ResolvedTable {
  readonly key: TableKey;
  readonly id: string;
  readonly name: string;
  readonly primaryFieldId: string;
  /** The primary field's name, so a formula can filter on it. */
  readonly primaryFieldName: string;
  /** Attachment fields on this table, found by type, not named in config. */
  readonly attachmentFieldIds: readonly string[];
}

/** The base as this crew addresses it: every name in config, resolved to an id. */
export interface ResolvedSchema {
  readonly baseId: string;
  readonly tables: Readonly<Record<TableKey, ResolvedTable>>;
  readonly fields: Readonly<Record<FieldKey, ResolvedField>>;
  fieldById(id: string): ResolvedField | undefined;
}

export interface SchemaReader {
  readTables(baseId: string): Promise<BaseTable[]>;
}

/** Reads the base schema over the meta API. Needs the schema.bases:read scope. */
export function httpSchemaReader(
  token: string,
  fetchImpl: typeof fetch = fetch,
): SchemaReader {
  return {
    async readTables(baseId) {
      const response = await fetchImpl(
        `https://api.airtable.com/v0/meta/bases/${baseId}/tables`,
        { headers: { Authorization: `Bearer ${token}` } },
      );

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        const hint =
          response.status === 403
            ? ' The token needs the schema.bases:read scope on this base.'
            : response.status === 404
              ? ' Check airtable.baseId in config.'
              : '';
        throw new AirtableRequestError(
          response.status,
          `Could not read the schema of base ${baseId}: ${response.status}.${hint} ${detail}`.trim(),
        );
      }

      return metaResponseSchema.parse(await response.json()).tables;
    },
  };
}

const ATTACHMENT_TYPE = 'multipleAttachments';

/**
 * Resolve every name in config to this base's ids, or throw listing what is
 * missing. A duplicated base keeps the names and gets new ids, so this is the
 * only place ids enter the process, and they are never written down.
 */
export async function resolveSchema(
  config: Config,
  reader: SchemaReader,
): Promise<ResolvedSchema> {
  const { baseId, tables: tableNames, fields: fieldNames } = config.airtable;
  const found = await reader.readTables(baseId);
  const problems: string[] = [];

  const byTableKey = new Map<TableKey, BaseTable>();
  for (const key of TABLE_KEYS) {
    const wanted = tableNames[key];
    const table = found.find((candidate) => candidate.name === wanted);
    if (table === undefined) {
      problems.push(
        `no table named "${wanted}" (config airtable.tables.${key}). The base has: ${found.map((candidate) => `"${candidate.name}"`).join(', ')}`,
      );
      continue;
    }
    byTableKey.set(key, table);
  }

  const fields: Partial<Record<FieldKey, ResolvedField>> = {};
  for (const key of FIELD_KEYS) {
    const tableKey = FIELD_TABLE[key];
    const table = byTableKey.get(tableKey);
    if (table === undefined) continue; // Already reported as a missing table.

    const wanted = fieldNames[key];
    const field = table.fields.find((candidate) => candidate.name === wanted);
    if (field === undefined) {
      problems.push(
        `table "${table.name}" has no field named "${wanted}" (config airtable.fields.${key})`,
      );
      continue;
    }

    fields[key] = {
      key,
      id: field.id,
      name: field.name,
      type: field.type,
      computed: COMPUTED_FIELD_TYPES.has(field.type),
    };
  }

  // The formula fields must actually be formulas. A plain text Development
  // field would let a person drag a card forward, which is the one thing
  // this design does not allow.
  for (const key of FORMULA_FIELD_KEYS) {
    const field = fields[key];
    if (field !== undefined && !field.computed) {
      problems.push(
        `field "${field.name}" (config airtable.fields.${key}) is type ${field.type}, not a formula. Status has to be derived, never typed in.`,
      );
    }
  }

  if (problems.length > 0) throw new SchemaMismatchError(baseId, problems);

  const tables: Partial<Record<TableKey, ResolvedTable>> = {};
  for (const [key, table] of byTableKey) {
    tables[key] = {
      key,
      id: table.id,
      name: table.name,
      primaryFieldId: table.primaryFieldId,
      primaryFieldName:
        table.fields.find((field) => field.id === table.primaryFieldId)?.name ??
        '',
      attachmentFieldIds: table.fields
        .filter((field) => field.type === ATTACHMENT_TYPE)
        .map((field) => field.id),
    };
  }

  const resolvedFields = fields as Record<FieldKey, ResolvedField>;
  const byId = new Map(
    Object.values(resolvedFields).map((field) => [field.id, field]),
  );

  return {
    baseId,
    tables: Object.freeze(tables as Record<TableKey, ResolvedTable>),
    fields: Object.freeze(resolvedFields),
    fieldById: (id) => byId.get(id),
  };
}
