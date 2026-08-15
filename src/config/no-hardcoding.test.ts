import { readFile, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FIELD_KEYS, TABLE_KEYS, loadConfig } from './index.js';

// fileURLToPath, not .pathname: a checkout in a directory with a space in
// its name comes back percent encoded otherwise.
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

async function scan(
  pattern: RegExp,
): Promise<{ file: string; line: number; text: string }[]> {
  const hits: { file: string; line: number; text: string }[] = [];

  for (const file of await sourceFiles(SRC)) {
    const source = await readFile(file, 'utf8');
    source.split(/\r?\n/).forEach((text, index) => {
      const found = pattern.exec(text);
      pattern.lastIndex = 0;
      if (found !== null) {
        hits.push({ file: file.slice(SRC.length), line: index + 1, text });
      }
    });
  }
  return hits;
}

/**
 * The rule from CLAUDE.md: nothing specific to a design system is hardcoded.
 * A person who clones this repo changes config, never code, so these are the
 * shapes that must never appear in a source file.
 */
describe('nothing of anyone’s is in the code', () => {
  it('holds no Airtable base, table or field id', async () => {
    // A test fixture may use appAAAA… or tblComponents. A real id has the
    // shape Airtable actually hands out.
    const hits = await scan(/\b(?:app|tbl|fld)[A-Za-z0-9]{14}\b/);
    const real = hits.filter(
      (hit) =>
        !/(?:app|tbl|fld)(?:A{14}|B{14}|X{14})/.test(hit.text) &&
        !hit.file.includes('.test.ts'),
    );

    expect(real).toEqual([]);
  });

  it('holds no Asana workspace or project gid', async () => {
    const hits = await scan(/['"`]\d{12,}['"`]/);
    const real = hits.filter(
      (hit) => !hit.file.includes('.test.ts') && !/0{8,}/.test(hit.text),
    );

    expect(real).toEqual([]);
  });

  it('holds no path off somebody’s machine', async () => {
    const hits = await scan(/['"`]\/(?:Users|home)\//);

    expect(hits.filter((hit) => !hit.file.includes('.test.ts'))).toEqual([]);
  });

  it('holds no repo, site or registry that belongs to one project', async () => {
    const hits = await scan(
      // The hosts the tools themselves live on are fine. Anything else is
      // somebody's project leaking into the code.
      /https?:\/\/(?!(?:api\.)?github\.com\/|(?:api|content)\.airtable\.com|airtable\.com\/|app\.asana\.com|mcp\.figma\.com|www\.npmjs\.com|registry\.npmjs\.org|schema|json-schema|127\.0\.0\.1|localhost|example\.com|docs\.example|staging\.example|ds\.example|figma\.com\/design)/,
    );
    const real = hits.filter((hit) => !hit.file.includes('.test.ts'));

    expect(real).toEqual([]);
  });
});

describe('the whole surface is reachable from config', () => {
  const config = loadConfig({
    env: {
      ANTHROPIC_API_KEY: 'x',
      GITHUB_TOKEN: 'x',
      AIRTABLE_TOKEN: 'x',
      ASANA_TOKEN: 'x',
      FIGMA_TOKEN: 'x',
      AIRTABLE_BASE_ID: 'appAAAAAAAAAAAAAA',
      ASANA_WORKSPACE_ID: '1',
      ASANA_PROJECT_ID: '2',
      REPO_PATH_OR_URL: '/tmp/design-system',
    },
  });

  it('addresses every table and field by a configured name', () => {
    for (const key of TABLE_KEYS) {
      expect(config.airtable.tables[key]).toBeTruthy();
    }
    for (const key of FIELD_KEYS) {
      expect(config.airtable.fields[key]).toBeTruthy();
    }
  });

  it('leaves every publish and deploy path unset until somebody sets it', () => {
    // A fresh clone can read and plan. It cannot ship anything by accident.
    expect(config.npm.token).toBeUndefined();
    expect(config.repo.productionCommand).toBeUndefined();
    expect(config.docs.path).toBeUndefined();
    expect(config.approvers).toEqual([]);
  });
});
