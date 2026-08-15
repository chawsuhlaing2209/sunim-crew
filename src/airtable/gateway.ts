import Airtable from 'airtable';
import { AirtableRequestError } from './errors.js';

/** What a cell may hold on the way in. Reads come back as unknown. */
export type CellValue =
  string | number | boolean | readonly string[] | undefined;
export type Cells = Record<string, CellValue>;

/** A record as it comes back, always keyed by field id, never by name. */
export interface RecordRow {
  readonly id: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface SelectOptions {
  readonly filterByFormula?: string;
  readonly maxRecords?: number;
}

/**
 * The record layer. One small seam: the real one talks to Airtable, tests
 * hand the client a fake and never touch the network.
 */
export interface UploadedAttachment {
  readonly filename: string;
  readonly contentType: string;
  /** base64, and no more than 5MB once encoded. */
  readonly file: string;
}

export interface RecordGateway {
  select(tableId: string, options?: SelectOptions): Promise<RecordRow[]>;
  /**
   * Put a file on a record's attachment field. Airtable takes the bytes
   * directly, so a screenshot never has to be hosted anywhere public first.
   */
  uploadAttachment(
    recordId: string,
    fieldId: string,
    attachment: UploadedAttachment,
  ): Promise<void>;
  create(
    tableId: string,
    records: readonly { fields: Cells }[],
  ): Promise<RecordRow[]>;
  update(
    tableId: string,
    records: readonly { id: string; fields: Cells }[],
  ): Promise<RecordRow[]>;
}

/** Airtable takes at most ten records per create or update request. */
const BATCH = 10;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

export function airtableGateway(
  token: string,
  baseId: string,
  fetchImpl: typeof fetch = fetch,
): RecordGateway {
  const base = new Airtable({ apiKey: token }).base(baseId);

  return {
    async uploadAttachment(recordId, fieldId, attachment) {
      // airtable.js has no method for this endpoint, so it is a plain call.
      const response = await fetchImpl(
        `https://content.airtable.com/v0/${baseId}/${recordId}/${fieldId}/uploadAttachment`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(attachment),
        },
      );

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new AirtableRequestError(
          response.status,
          `Could not attach ${attachment.filename} to ${recordId}: ${response.status} ${detail.slice(0, 200)}`,
        );
      }
    },

    async select(tableId, options = {}) {
      const records = await base(tableId)
        .select({
          // Ids, not names. The name map is resolved once, at startup.
          returnFieldsByFieldId: true,
          ...(options.filterByFormula === undefined
            ? {}
            : { filterByFormula: options.filterByFormula }),
          ...(options.maxRecords === undefined
            ? {}
            : { maxRecords: options.maxRecords }),
        })
        .all();

      return records.map((record) => ({
        id: record.id,
        fields: record.fields,
      }));
    },

    async create(tableId, records) {
      const out: RecordRow[] = [];
      for (const batch of chunk(records, BATCH)) {
        const created = await base(tableId).create(
          batch.map((record) => ({ fields: record.fields })),
        );
        out.push(
          ...created.map((record) => ({
            id: record.id,
            fields: record.fields,
          })),
        );
      }
      return out;
    },

    async update(tableId, records) {
      const out: RecordRow[] = [];
      for (const batch of chunk(records, BATCH)) {
        const updated = await base(tableId).update(
          batch.map((record) => ({ id: record.id, fields: record.fields })),
        );
        out.push(
          ...updated.map((record) => ({
            id: record.id,
            fields: record.fields,
          })),
        );
      }
      return out;
    },
  };
}

/** Escape a value for use inside a filterByFormula string literal. */
export function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** Reference a field by name inside a formula. Formulas cannot use field ids. */
export function fieldRef(name: string): string {
  return `{${name.replace(/[{}]/g, '')}}`;
}
