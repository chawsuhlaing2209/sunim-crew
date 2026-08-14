import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config/index.js';
import type { Config } from '../config/index.js';
import { SchemaMismatchError } from './errors.js';
import { resolveSchema } from './schema.js';
import type { BaseTable, SchemaReader } from './schema.js';

const env = {
  ANTHROPIC_API_KEY: 'x',
  GITHUB_TOKEN: 'x',
  AIRTABLE_TOKEN: 'x',
  ASANA_TOKEN: 'x',
  FIGMA_TOKEN: 'x',
};

const project = {
  airtable: { baseId: 'appAAAAAAAAAAAAAA' },
  asana: { workspaceId: '1', projectId: '2' },
  repo: { pathOrUrl: '/tmp/design-system' },
};

function config(overrides: Record<string, unknown> = {}): Config {
  return loadConfig({ env, project: { ...project, ...overrides } });
}

/** A base that matches the shipped template, with ids nothing else knows. */
function baseTables(): BaseTable[] {
  return [
    {
      id: 'tblComponents',
      name: 'Components',
      primaryFieldId: 'fldName',
      fields: [
        { id: 'fldName', name: 'Component', type: 'singleLineText' },
        { id: 'fldFigma', name: 'Figma', type: 'url' },
        { id: 'fldDesign', name: 'Design', type: 'url' },
        { id: 'fldCommit', name: 'Commit', type: 'url' },
        { id: 'fldStorybook', name: 'Storybook', type: 'url' },
        { id: 'fldStaging', name: 'Staging URL', type: 'url' },
        { id: 'fldProduction', name: 'Production URL', type: 'url' },
        { id: 'fldAstro', name: 'Astro Link', type: 'url' },
        { id: 'fldDevelopment', name: 'Development', type: 'formula' },
        { id: 'fldSync', name: 'Synchronization %', type: 'formula' },
        { id: 'fldTotal', name: 'Total Tests', type: 'count' },
        { id: 'fldPassed', name: 'Passed Tests', type: 'rollup' },
      ],
    },
    {
      id: 'tblTests',
      name: 'Storybook Testing',
      primaryFieldId: 'fldCase',
      fields: [
        { id: 'fldCase', name: 'Case', type: 'singleLineText' },
        { id: 'fldResult', name: 'Testing Results', type: 'singleSelect' },
        { id: 'fldLink', name: 'Components', type: 'multipleRecordLinks' },
        { id: 'fldShot', name: 'Screenshot', type: 'multipleAttachments' },
      ],
    },
  ];
}

function reader(tables: BaseTable[]): SchemaReader {
  return { readTables: () => Promise.resolve(tables) };
}

describe('resolveSchema', () => {
  it('resolves every name in config to this base’s ids', async () => {
    const schema = await resolveSchema(config(), reader(baseTables()));

    expect(schema.tables.components.id).toBe('tblComponents');
    expect(schema.tables.tests.id).toBe('tblTests');
    expect(schema.fields.commit.id).toBe('fldCommit');
    expect(schema.fields.commit.name).toBe('Commit');
    expect(schema.fields.testResults.id).toBe('fldResult');
  });

  it('works on a duplicated base, where every id is different', async () => {
    const duplicated = baseTables().map((table) => ({
      ...table,
      id: `${table.id}Copy`,
      primaryFieldId: `${table.primaryFieldId}Copy`,
      fields: table.fields.map((field) => ({
        ...field,
        id: `${field.id}Copy`,
      })),
    }));

    const schema = await resolveSchema(config(), reader(duplicated));

    expect(schema.tables.components.id).toBe('tblComponentsCopy');
    expect(schema.fields.commit.id).toBe('fldCommitCopy');
  });

  it('takes a base that names its fields differently', async () => {
    const renamed = baseTables();
    renamed[0]!.fields[3]!.name = 'Git commit';

    const schema = await resolveSchema(
      config({
        airtable: { ...project.airtable, fields: { commit: 'Git commit' } },
      }),
      reader(renamed),
    );

    expect(schema.fields.commit.id).toBe('fldCommit');
    expect(schema.fields.commit.name).toBe('Git commit');
  });

  it('marks computed fields, and finds attachment fields by type', async () => {
    const schema = await resolveSchema(config(), reader(baseTables()));

    expect(schema.fields.development.computed).toBe(true);
    expect(schema.fields.synchronization.computed).toBe(true);
    expect(schema.fields.totalTests.computed).toBe(true);
    expect(schema.fields.commit.computed).toBe(false);
    expect(schema.tables.tests.attachmentFieldIds).toEqual(['fldShot']);
  });

  it('lists every missing name at once, with the config path that sets it', async () => {
    const broken = baseTables();
    broken[0]!.fields = broken[0]!.fields.filter(
      (field) => field.name !== 'Commit' && field.name !== 'Astro Link',
    );
    broken[1]!.name = 'Tests';

    try {
      await resolveSchema(config(), reader(broken));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaMismatchError);
      const { problems } = error as SchemaMismatchError;
      expect(
        problems.some((line) => line.includes('airtable.fields.commit')),
      ).toBe(true);
      expect(
        problems.some((line) => line.includes('airtable.fields.astro')),
      ).toBe(true);
      expect(
        problems.some((line) => line.includes('airtable.tables.tests')),
      ).toBe(true);
      // The message says what the base does have, so the fix is obvious.
      expect((error as Error).message).toContain('"Tests"');
    }
  });

  it('refuses a base where Development is not a formula', async () => {
    const typed = baseTables();
    typed[0]!.fields[8]!.type = 'singleSelect';

    await expect(resolveSchema(config(), reader(typed))).rejects.toThrow(
      /not a formula/,
    );
  });
});
