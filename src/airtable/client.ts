import { EVIDENCE_FIELD_KEYS, FORMULA_FIELD_KEYS } from '../config/index.js';
import type { Config, EvidenceFieldKey, FieldKey } from '../config/index.js';
import { FormulaFieldWriteError } from './errors.js';
import { airtableGateway, fieldRef, quote } from './gateway.js';
import type { Cells, RecordGateway, RecordRow } from './gateway.js';
import { httpSchemaReader, resolveSchema } from './schema.js';
import type { ResolvedSchema, SchemaReader } from './schema.js';
import { developmentStatusSchema, testResultSchema } from './types.js';
import type {
  Attachment,
  ComponentRow,
  DevelopmentStatus,
  NewTestRow,
  TestRow,
  TestRowPatch,
} from './types.js';

/** What the manager may write. Verified evidence, nothing else. */
export type EvidencePatch = Partial<Record<EvidenceFieldKey, string>>;

export interface AirtableClient {
  /** The base as resolved at startup. Ids live here and nowhere else. */
  readonly schema: ResolvedSchema;
  getComponent(recordId: string): Promise<ComponentRow | undefined>;
  findComponentByName(name: string): Promise<ComponentRow | undefined>;
  listComponents(): Promise<ComponentRow[]>;
  listComponentsByStatus(status: DevelopmentStatus): Promise<ComponentRow[]>;
  writeEvidence(
    recordId: string,
    evidence: EvidencePatch,
  ): Promise<ComponentRow>;
  listTestRows(componentRecordId: string): Promise<TestRow[]>;
  createTestRows(
    componentRecordId: string,
    rows: readonly NewTestRow[],
  ): Promise<TestRow[]>;
  updateTestRow(recordId: string, patch: TestRowPatch): Promise<TestRow>;
}

function text(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() === '' ? undefined : value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function ids(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function attachments(value: unknown): Attachment[] {
  if (!Array.isArray(value)) return [];
  const out: Attachment[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const id = text(record['id']);
    const url = text(record['url']);
    if (id === undefined || url === undefined) continue;
    out.push({ id, url, filename: text(record['filename']) ?? '' });
  }
  return out;
}

export interface ClientDeps {
  readonly gateway?: RecordGateway;
  readonly schemaReader?: SchemaReader;
}

/**
 * Resolve the base schema, then hand back a client that only ever addresses
 * tables and fields by the ids it just resolved. Call once at startup.
 */
export async function connect(
  config: Config,
  deps: ClientDeps = {},
): Promise<AirtableClient> {
  const reader = deps.schemaReader ?? httpSchemaReader(config.airtable.token);
  const schema = await resolveSchema(config, reader);
  const gateway =
    deps.gateway ??
    airtableGateway(config.airtable.token, config.airtable.baseId);

  return createClient(schema, gateway);
}

export function createClient(
  schema: ResolvedSchema,
  gateway: RecordGateway,
): AirtableClient {
  const components = schema.tables.components;
  const tests = schema.tables.tests;
  const field = (key: FieldKey) => schema.fields[key];

  /**
   * The one door every write goes through. A formula field never gets past
   * here, whether it was named by its config key or by a raw field id.
   */
  function guard(payload: Readonly<Record<string, unknown>>): void {
    for (const id of Object.keys(payload)) {
      const resolved = schema.fieldById(id);
      if (resolved === undefined) continue;
      if ((FORMULA_FIELD_KEYS as readonly string[]).includes(resolved.key)) {
        throw new FormulaFieldWriteError(
          resolved.name,
          `config calls it airtable.fields.${resolved.key}, which the crew derives`,
        );
      }
      if (resolved.computed) {
        throw new FormulaFieldWriteError(
          resolved.name,
          `the base computes it, type ${resolved.type}`,
        );
      }
    }
  }

  function toComponent(row: RecordRow): ComponentRow {
    const at = (key: FieldKey) => row.fields[field(key).id];
    const statusRaw = text(at('development'));
    const parsed =
      statusRaw === undefined
        ? undefined
        : developmentStatusSchema.safeParse(statusRaw);

    return {
      id: row.id,
      name: text(row.fields[components.primaryFieldId]) ?? '',
      status: parsed?.success === true ? parsed.data : undefined,
      statusRaw,
      figma: text(at('figma')),
      design: text(at('design')),
      commit: text(at('commit')),
      storybook: text(at('storybook')),
      stagingUrl: text(at('stagingUrl')),
      productionUrl: text(at('productionUrl')),
      astro: text(at('astro')),
      totalTests: count(at('totalTests')),
      passedTests: count(at('passedTests')),
      synchronization: count(at('synchronization')),
    };
  }

  function toTestRow(row: RecordRow): TestRow {
    const resultRaw = text(row.fields[field('testResults').id]);
    const parsed =
      resultRaw === undefined
        ? undefined
        : testResultSchema.safeParse(resultRaw);

    return {
      id: row.id,
      name: text(row.fields[tests.primaryFieldId]) ?? '',
      result: parsed?.success === true ? parsed.data : undefined,
      resultRaw,
      componentIds: ids(row.fields[field('componentLink').id]),
      attachments: tests.attachmentFieldIds.flatMap((id) =>
        attachments(row.fields[id]),
      ),
    };
  }

  async function one(recordId: string): Promise<ComponentRow | undefined> {
    const rows = await gateway.select(components.id, {
      filterByFormula: `RECORD_ID() = ${quote(recordId)}`,
      maxRecords: 1,
    });
    const row = rows[0];
    return row === undefined ? undefined : toComponent(row);
  }

  return {
    schema,

    getComponent: one,

    async findComponentByName(name) {
      const rows = await gateway.select(components.id, {
        filterByFormula: `${fieldRef(components.primaryFieldName)} = ${quote(name)}`,
        maxRecords: 1,
      });
      const row = rows[0];
      return row === undefined ? undefined : toComponent(row);
    },

    async listComponents() {
      const rows = await gateway.select(components.id);
      return rows.map(toComponent);
    },

    async listComponentsByStatus(status) {
      const rows = await gateway.select(components.id, {
        filterByFormula: `${fieldRef(field('development').name)} = ${quote(status)}`,
      });
      return rows.map(toComponent);
    },

    async writeEvidence(recordId, evidence) {
      const payload: Cells = {};
      for (const key of EVIDENCE_FIELD_KEYS) {
        const value = evidence[key];
        if (value !== undefined) payload[field(key).id] = value;
      }

      // A caller reaching past the evidence fields, most likely at status.
      // Types stop this at compile time, plain JavaScript does not.
      const stray = Object.keys(evidence).find(
        (key) => !EVIDENCE_FIELD_KEYS.includes(key as EvidenceFieldKey),
      );
      if (stray !== undefined) {
        throw new FormulaFieldWriteError(
          schema.fields[stray as FieldKey]?.name ?? stray,
          'only the evidence fields may be written',
        );
      }

      if (Object.keys(payload).length === 0) {
        throw new Error('writeEvidence was given nothing to write');
      }

      guard(payload);
      const [updated] = await gateway.update(components.id, [
        { id: recordId, fields: payload },
      ]);
      if (updated === undefined) {
        throw new Error(`Airtable did not return the updated row ${recordId}`);
      }
      return toComponent(updated);
    },

    async listTestRows(componentRecordId) {
      // Link fields cannot be filtered on by record id in a formula, so the
      // rows are matched here. One component has a handful of cases.
      const rows = await gateway.select(tests.id);
      return rows
        .map(toTestRow)
        .filter((row) => row.componentIds.includes(componentRecordId));
    },

    async createTestRows(componentRecordId, rows) {
      const payloads = rows.map((row) => ({
        fields: {
          [tests.primaryFieldId]: row.name,
          [field('testResults').id]: row.result,
          [field('componentLink').id]: [componentRecordId],
        } satisfies Cells,
      }));

      for (const payload of payloads) guard(payload.fields);
      const created = await gateway.create(tests.id, payloads);
      return created.map(toTestRow);
    },

    async updateTestRow(recordId, patch) {
      const payload: Cells = {};
      if (patch.name !== undefined) payload[tests.primaryFieldId] = patch.name;
      if (patch.result !== undefined) {
        payload[field('testResults').id] = patch.result;
      }
      if (Object.keys(payload).length === 0) {
        throw new Error('updateTestRow was given nothing to write');
      }

      guard(payload);
      const [updated] = await gateway.update(tests.id, [
        { id: recordId, fields: payload },
      ]);
      if (updated === undefined) {
        throw new Error(`Airtable did not return the updated row ${recordId}`);
      }
      return toTestRow(updated);
    },
  };
}
