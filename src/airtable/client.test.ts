import { beforeEach, describe, expect, it } from 'vitest';
import { createClient } from './client.js';
import type { AirtableClient } from './client.js';
import { FormulaFieldWriteError } from './errors.js';
import type { Cells, RecordGateway, RecordRow } from './gateway.js';
import type { ResolvedField, ResolvedSchema } from './schema.js';
import { COMPUTED_FIELD_TYPES } from './schema.js';
import type { FieldKey } from '../config/index.js';

const FIELDS: Record<FieldKey, { id: string; name: string; type: string }> = {
  figma: { id: 'fldFigma', name: 'Figma', type: 'url' },
  design: { id: 'fldDesign', name: 'Design', type: 'url' },
  commit: { id: 'fldCommit', name: 'Commit', type: 'url' },
  storybook: { id: 'fldStorybook', name: 'Storybook', type: 'url' },
  stagingUrl: { id: 'fldStaging', name: 'Staging URL', type: 'url' },
  productionUrl: { id: 'fldProduction', name: 'Production URL', type: 'url' },
  astro: { id: 'fldAstro', name: 'Astro Link', type: 'url' },
  development: { id: 'fldDevelopment', name: 'Development', type: 'formula' },
  synchronization: {
    id: 'fldSync',
    name: 'Synchronization %',
    type: 'formula',
  },
  totalTests: { id: 'fldTotal', name: 'Total Tests', type: 'count' },
  passedTests: { id: 'fldPassed', name: 'Passed Tests', type: 'rollup' },
  testResults: {
    id: 'fldResult',
    name: 'Testing Results',
    type: 'singleSelect',
  },
  componentLink: {
    id: 'fldLink',
    name: 'Components',
    type: 'multipleRecordLinks',
  },
  expectedResults: {
    id: 'fldExpected',
    name: 'Expected Results',
    type: 'multilineText',
  },
  suggestion: {
    id: 'fldSuggestion',
    name: 'Suggestion for Improvement',
    type: 'multilineText',
  },
};

function schema(): ResolvedSchema {
  const fields = Object.fromEntries(
    Object.entries(FIELDS).map(([key, field]) => [
      key,
      {
        key: key as FieldKey,
        ...field,
        computed: COMPUTED_FIELD_TYPES.has(field.type),
      } satisfies ResolvedField,
    ]),
  ) as Record<FieldKey, ResolvedField>;

  const byId = new Map(
    Object.values(fields).map((field) => [field.id, field] as const),
  );

  return {
    baseId: 'appAAAAAAAAAAAAAA',
    tables: {
      components: {
        key: 'components',
        id: 'tblComponents',
        name: 'Components',
        primaryFieldId: 'fldName',
        primaryFieldName: 'Component',
        attachmentFieldIds: [],
      },
      tests: {
        key: 'tests',
        id: 'tblTests',
        name: 'Storybook Testing',
        primaryFieldId: 'fldCase',
        primaryFieldName: 'Case',
        attachmentFieldIds: ['fldShot'],
      },
    },
    fields,
    fieldById: (id) => byId.get(id),
  };
}

interface Call {
  readonly kind: 'select' | 'create' | 'update' | 'upload';
  readonly tableId: string;
  readonly formula?: string | undefined;
  readonly fields?: readonly Cells[];
}

/** A stand in for Airtable. Records every call so a test can assert on it. */
function fakeGateway(rows: Record<string, RecordRow[]>): {
  gateway: RecordGateway;
  calls: Call[];
} {
  const calls: Call[] = [];
  const gateway: RecordGateway = {
    select(tableId, options = {}) {
      calls.push({ kind: 'select', tableId, formula: options.filterByFormula });
      return Promise.resolve(rows[tableId] ?? []);
    },
    create(tableId, records) {
      calls.push({
        kind: 'create',
        tableId,
        fields: records.map((record) => record.fields),
      });
      return Promise.resolve(
        records.map((record, index) => ({
          id: `recNew${index}`,
          fields: record.fields,
        })),
      );
    },
    uploadAttachment(recordId, fieldId, attachment) {
      calls.push({
        kind: 'upload',
        tableId: `${recordId}/${fieldId}`,
        fields: [{ filename: attachment.filename }],
      });
      return Promise.resolve();
    },
    update(tableId, records) {
      calls.push({
        kind: 'update',
        tableId,
        fields: records.map((record) => record.fields),
      });
      return Promise.resolve(
        records.map((record) => ({ id: record.id, fields: record.fields })),
      );
    },
  };
  return { gateway, calls };
}

const component: RecordRow = {
  id: 'recButton',
  fields: {
    fldName: 'Button',
    fldFigma: 'https://figma.com/file/abc',
    fldCommit: 'https://github.com/owner/ds/commit/abc123',
    fldDevelopment: 'To be staged',
    fldTotal: 4,
    fldPassed: 3,
  },
};

const testRow: RecordRow = {
  id: 'recCase1',
  fields: {
    fldCase: 'Button, primary, hover',
    fldResult: 'Failed',
    fldLink: ['recButton'],
    fldShot: [
      { id: 'att1', url: 'https://example.com/shot.png', filename: 'shot.png' },
    ],
  },
};

describe('the client', () => {
  let calls: Call[];
  let client: AirtableClient;

  beforeEach(() => {
    const fake = fakeGateway({
      tblComponents: [component],
      tblTests: [testRow],
    });
    calls = fake.calls;
    client = createClient(schema(), fake.gateway);
  });

  it('reads a component and its derived status', async () => {
    const row = await client.getComponent('recButton');

    expect(row?.name).toBe('Button');
    expect(row?.status).toBe('To be staged');
    expect(row?.commit).toBe('https://github.com/owner/ds/commit/abc123');
    expect(row?.totalTests).toBe(4);
  });

  it('addresses tables by the id it resolved, never by name', async () => {
    await client.listComponents();

    expect(calls[0]?.tableId).toBe('tblComponents');
  });

  it('lists components by status', async () => {
    await client.listComponentsByStatus('Ready for Testing');

    expect(calls[0]?.formula).toBe("{Development} = 'Ready for Testing'");
  });

  it('keeps a status the formula invented, without pretending to know it', async () => {
    const fake = fakeGateway({
      tblComponents: [
        { id: 'recX', fields: { fldDevelopment: 'Something new' } },
      ],
    });
    const row = await createClient(schema(), fake.gateway).getComponent('recX');

    expect(row?.status).toBeUndefined();
    expect(row?.statusRaw).toBe('Something new');
  });

  it('writes evidence by field id', async () => {
    await client.writeEvidence('recButton', {
      commit: 'https://github.com/owner/ds/commit/abc123',
      storybook: 'https://staging.example.com/storybook',
    });

    expect(calls[0]?.kind).toBe('update');
    expect(calls[0]?.fields?.[0]).toEqual({
      fldCommit: 'https://github.com/owner/ds/commit/abc123',
      fldStorybook: 'https://staging.example.com/storybook',
    });
  });

  it('refuses to write the Development field, and sends nothing', async () => {
    await expect(
      client.writeEvidence('recButton', {
        development: 'Completed',
      } as unknown as { commit: string }),
    ).rejects.toThrow(FormulaFieldWriteError);

    expect(calls).toHaveLength(0);
  });

  it('refuses to write the Synchronization field', async () => {
    await expect(
      client.writeEvidence('recButton', {
        synchronization: 100,
      } as unknown as { commit: string }),
    ).rejects.toThrow(FormulaFieldWriteError);

    expect(calls).toHaveLength(0);
  });

  it('refuses a field the base computes, whatever config calls it', async () => {
    await expect(
      client.writeEvidence('recButton', {
        totalTests: 9,
      } as unknown as { commit: string }),
    ).rejects.toThrow(FormulaFieldWriteError);
  });

  it('refuses a write with nothing in it', async () => {
    await expect(client.writeEvidence('recButton', {})).rejects.toThrow(
      /nothing to write/,
    );
  });

  it('reads the test rows of one component, with their attachments', async () => {
    const rows = await client.listTestRows('recButton');

    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Button, primary, hover');
    expect(rows[0]?.result).toBe('Failed');
    expect(rows[0]?.attachments[0]?.filename).toBe('shot.png');
  });

  it('leaves out test rows that belong to another component', async () => {
    const rows = await client.listTestRows('recInput');

    expect(rows).toHaveLength(0);
  });

  it('writes test rows linked to their component', async () => {
    await client.createTestRows('recButton', [
      { name: 'Button, primary, hover', result: 'Passed' },
    ]);

    expect(calls[0]?.kind).toBe('create');
    expect(calls[0]?.fields?.[0]).toEqual({
      fldCase: 'Button, primary, hover',
      fldResult: 'Passed',
      fldLink: ['recButton'],
    });
  });

  it('marks a row fixed, to be retested', async () => {
    const row = await client.updateTestRow('recCase1', {
      result: 'Fixed (To re-test)',
    });

    expect(calls[0]?.fields?.[0]).toEqual({
      fldResult: 'Fixed (To re-test)',
    });
    expect(row.result).toBe('Fixed (To re-test)');
  });
});
