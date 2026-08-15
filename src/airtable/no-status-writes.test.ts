import { readFile, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EVIDENCE_FIELD_KEYS, FORMULA_FIELD_KEYS } from '../config/index.js';
import type { FieldKey } from '../config/index.js';
import { createClient } from './client.js';
import { FormulaFieldWriteError } from './errors.js';
import type { Cells, RecordGateway } from './gateway.js';
import { COMPUTED_FIELD_TYPES } from './schema.js';
import type { ResolvedField, ResolvedSchema } from './schema.js';

const SRC = fileURLToPath(new URL('..', import.meta.url));

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(full)));
    } else if (entry.isFile() && extname(entry.name) === '.ts') {
      files.push(full);
    }
  }
  return files;
}

interface SourceFile {
  readonly path: string;
  readonly text: string;
}

async function sources(): Promise<SourceFile[]> {
  const files = await sourceFiles(SRC);
  return await Promise.all(
    files.map(async (path) => ({
      path: path.slice(SRC.length),
      text: await readFile(path, 'utf8'),
    })),
  );
}

/**
 * Every key written by a literal writeEvidence call that is not an evidence
 * field. A computed key, writeEvidence(id, { [evidence.field]: claim }), is
 * typed EvidenceFieldKey and is checked again at runtime, so it is left to
 * those two.
 */
function writtenKeysIn(text: string): string[] {
  const keys: string[] = [];

  for (const call of text.matchAll(/writeEvidence\([^,)]*,\s*\{([^}]*)\}/gs)) {
    const body = call[1] ?? '';
    for (const key of body.matchAll(/(?:^|[\s{,])([A-Za-z_]\w*)\s*:/g)) {
      const name = key[1] ?? '';
      if (!(EVIDENCE_FIELD_KEYS as readonly string[]).includes(name)) {
        keys.push(name);
      }
    }
  }
  return keys;
}

/**
 * The one idea CLAUDE.md protects: "Nobody writes the Development status. It
 * is a formula." This is that rule as a build step. It is a text scan on
 * purpose, because the type system is the thing an `as never` gets around,
 * and the scan does not care what anybody asserted.
 */
describe('no code writes the Development field', () => {
  it('catches the write it is looking for', () => {
    // The scan proving itself. A check of this kind that only ever passes is
    // indistinguishable from one that matches nothing at all.
    expect(
      writtenKeysIn('await airtable.writeEvidence(id, { development: done });'),
    ).toEqual(['development']);
    expect(
      writtenKeysIn('await airtable.writeEvidence(id, { commit: url });'),
    ).toEqual([]);
  });

  it('passes no literal formula field to writeEvidence', async () => {
    const offenders: string[] = [];

    for (const file of await sources()) {
      // The tests that try this on purpose are the ones below, proving the
      // client refuses. Everything that ships is held to the rule.
      if (file.path.endsWith('.test.ts')) continue;
      for (const key of writtenKeysIn(file.text)) {
        offenders.push(`${file.path}: writeEvidence({ ${key}: ... })`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('names no formula field where a write is being built', async () => {
    const offenders: string[] = [];
    const pattern = new RegExp(
      `\\b(${FORMULA_FIELD_KEYS.join('|')})\\s*:`,
      'g',
    );

    for (const file of await sources()) {
      // The base's own layer knows these field names, and has to: it resolves
      // them, and it refuses writes to them. Everywhere else, a formula key
      // in a key position is somebody building a payload.
      if (
        file.path.startsWith('airtable/') ||
        file.path.startsWith('config/')
      ) {
        continue;
      }
      // A fixture naming a formula field is reading one, not writing it.
      if (file.path.endsWith('.test.ts')) continue;
      for (const hit of file.text.matchAll(pattern)) {
        offenders.push(`${file.path}: ${hit[0]}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('lets nothing but the client reach the record gateway', async () => {
    const offenders: string[] = [];

    for (const file of await sources()) {
      if (file.path === 'airtable/client.ts') continue;
      if (file.path.endsWith('.test.ts')) continue;
      for (const hit of file.text.matchAll(/\bgateway\.(update|create)\(/g)) {
        offenders.push(`${file.path}: ${hit[0]}`);
      }
    }

    // One door, so there is one guard on it.
    expect(offenders).toEqual([]);
  });
});

const FIELDS: Record<FieldKey, { id: string; name: string; type: string }> = {
  figma: { id: 'fldA', name: 'Figma', type: 'url' },
  design: { id: 'fldB', name: 'Design', type: 'url' },
  commit: { id: 'fldC', name: 'Commit', type: 'url' },
  storybook: { id: 'fldD', name: 'Storybook', type: 'url' },
  stagingUrl: { id: 'fldE', name: 'Staging URL', type: 'url' },
  productionUrl: { id: 'fldF', name: 'Production URL', type: 'url' },
  astro: { id: 'fldG', name: 'Astro Link', type: 'url' },
  development: { id: 'fldH', name: 'Development', type: 'formula' },
  synchronization: { id: 'fldI', name: 'Synchronization %', type: 'formula' },
  totalTests: { id: 'fldJ', name: 'Total Tests', type: 'count' },
  passedTests: { id: 'fldK', name: 'Passed Tests', type: 'rollup' },
  testResults: { id: 'fldL', name: 'Testing Results', type: 'singleSelect' },
  componentLink: {
    id: 'fldM',
    name: 'Components',
    type: 'multipleRecordLinks',
  },
  expectedResults: {
    id: 'fldN',
    name: 'Expected Results',
    type: 'multilineText',
  },
  suggestion: { id: 'fldO', name: 'Suggestion', type: 'multilineText' },
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

  const byId = new Map(Object.values(fields).map((field) => [field.id, field]));

  return {
    tables: {
      components: {
        key: 'components',
        id: 'tblComponents',
        name: 'Components',
      },
      tests: { key: 'tests', id: 'tblTests', name: 'Storybook Testing' },
    },
    fields,
    fieldById: (id: string) => byId.get(id),
  } as unknown as ResolvedSchema;
}

function watchingGateway(): RecordGateway & { writes: Cells[] } {
  const writes: Cells[] = [];
  return {
    writes,
    select: () => Promise.resolve([]),
    uploadAttachment: () => Promise.resolve(),
    create: (_table, records) => {
      writes.push(...records.map((record) => record.fields));
      return Promise.resolve([]);
    },
    update: (_table, records) => {
      writes.push(...records.map((record) => record.fields));
      return Promise.resolve([]);
    },
  };
}

/**
 * The scan reads what is written today. This is what happens if somebody
 * gets past it, by a cast, by a field id, or by a base whose Development
 * field somebody quietly turned into a select.
 */
describe('and the client refuses even when asked directly', () => {
  it('refuses the field by its config key', async () => {
    const gateway = watchingGateway();
    const client = createClient(schema(), gateway);

    await expect(
      client.writeEvidence('rec1', {
        development: 'Completed',
      } as never),
    ).rejects.toBeInstanceOf(FormulaFieldWriteError);
    expect(gateway.writes).toEqual([]);
  });

  it('writes the evidence field it was actually given', async () => {
    const gateway = watchingGateway();
    const client = createClient(schema(), gateway);

    await client
      .writeEvidence('rec1', { commit: 'https://github.com/o/r/commit/abc' })
      .catch(() => undefined);

    expect(gateway.writes).toEqual([
      { fldC: 'https://github.com/o/r/commit/abc' },
    ]);
  });
});
