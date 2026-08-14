import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  contractValid,
  isInconclusive,
  parseJsonc,
  tokenClean,
} from './index.js';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sunim-verify-'));
});

async function write(name: string, body: string): Promise<string> {
  const path = join(dir, name);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, body, 'utf8');
  return path;
}

const CONTRACT = {
  id: 'button',
  name: 'Button',
  props: { variant: { type: 'union' } },
  variants: ['primary', 'secondary'],
  sizes: ['md', 'lg'],
  states: ['default', 'hover', 'focus', 'disabled'],
  tokens: ['accent', 'surface', 'text-heading', 'focus-ring'],
  a11y: { role: 'button', focusOrder: 'natural', contrast: 'AA' },
  usage: { whenToUse: 'A primary action.', whenNot: 'Navigation, use a link.' },
  storybookId: 'ui-button--primary',
  astroDocsUrl: 'https://docs.example.com/components/button',
  version: '1.0.0',
};

describe('tokenClean', () => {
  it('passes source that only uses tokens', async () => {
    const path = await write(
      'clean/button.css',
      '.button { color: var(--color-text-heading); background: var(--color-accent); }',
    );

    const result = await tokenClean(path);

    expect(result.ok).toBe(true);
    expect(result.evidence['filesScanned']).toBe(1);
  });

  it('finds raw hex and says where', async () => {
    const path = await write(
      'dirty/button.css',
      '.button {\n  color: #1a1a1a;\n  border: 1px solid var(--color-border);\n}',
    );

    const result = await tokenClean(path);

    expect(result.ok).toBe(false);
    expect(result.evidence['findings']).toEqual([
      expect.objectContaining({ line: 2, match: '#1a1a1a' }),
    ]);
  });

  it('catches three, four, six and eight digit hex', async () => {
    const path = await write(
      'shapes/tokens.ts',
      'const a = "#fff";\nconst b = "#ffff";\nconst c = "#ff00aa";\nconst d = "#ff00aacc";',
    );

    const result = await tokenClean(path);

    expect((result.evidence['findings'] as unknown[]).length).toBe(4);
  });

  it('leaves alone what is not a colour', async () => {
    const path = await write(
      'ids/app.ts',
      'document.querySelector("#app");\nconst url = "https://example.com/page#section";',
    );

    expect((await tokenClean(path)).ok).toBe(true);
  });

  it('respects a line that says the literal is deliberate', async () => {
    const path = await write(
      'allowed/brand.ts',
      'export const brandMark = "#ff6600"; // sunim-allow-raw-hex, the logo is fixed',
    );

    expect((await tokenClean(path)).ok).toBe(true);
  });

  it('walks a directory and skips what is not source', async () => {
    await write('tree/src/button.tsx', 'const a = 1;');
    await write('tree/src/deep/card.css', '.card { color: #abc; }');
    await write('tree/node_modules/dep/index.js', 'const bad = "#000000";');
    await write('tree/README.md', 'Use #ffffff somewhere');

    const result = await tokenClean(join(dir, 'tree'));

    expect(result.ok).toBe(false);
    expect(result.evidence['filesScanned']).toBe(2);
    expect(result.evidence['findings']).toEqual([
      expect.objectContaining({ match: '#abc' }),
    ]);
  });

  it('says inconclusive when the path is not there', async () => {
    expect(isInconclusive(await tokenClean(join(dir, 'nowhere')))).toBe(true);
  });
});

describe('parseJsonc', () => {
  it('takes comments and a trailing comma, as the doc shows', () => {
    expect(
      parseJsonc(`{
        // the id
        "id": "button", /* inline */
        "url": "https://example.com//not-a-comment",
      }`),
    ).toEqual({ id: 'button', url: 'https://example.com//not-a-comment' });
  });
});

describe('contractValid', () => {
  it('passes a complete contract and reports what it holds', async () => {
    const path = await write('contract/ok.json', JSON.stringify(CONTRACT));

    const result = await contractValid(path);

    expect(result.ok).toBe(true);
    expect(result.evidence['name']).toBe('Button');
    expect(result.evidence['version']).toBe('1.0.0');
    // 2 variants, 2 sizes, 4 states is what QA owes.
    expect(result.evidence['expectedCases']).toBe(16);
  });

  it('fails when the file is not there', async () => {
    const result = await contractValid(join(dir, 'contract/missing.json'));

    expect(result.ok).toBe(false);
    expect(result.evidence['summary']).toContain('no contract file');
  });

  it('fails when it does not parse', async () => {
    const path = await write('contract/broken.json', '{ "id": ');

    expect((await contractValid(path)).ok).toBe(false);
  });

  it('names every missing or wrong field at once', async () => {
    const path = await write(
      'contract/thin.json',
      JSON.stringify({
        id: 'Button',
        name: 'Button',
        variants: [],
        version: 'one',
      }),
    );

    const result = await contractValid(path);
    const problems = result.evidence['problems'] as string[];

    expect(result.ok).toBe(false);
    expect(problems.some((line) => line.startsWith('id'))).toBe(true);
    expect(problems.some((line) => line.startsWith('variants'))).toBe(true);
    expect(problems.some((line) => line.startsWith('version'))).toBe(true);
    expect(problems.some((line) => line.startsWith('a11y'))).toBe(true);
    expect(problems.some((line) => line.startsWith('storybookId'))).toBe(true);
  });

  it('accepts the jsonc form the doc prints', async () => {
    const path = await write(
      'contract/commented.jsonc',
      `{
        // per component, ships with the code
        ${JSON.stringify(CONTRACT).slice(1, -1)},
      }`,
    );

    expect((await contractValid(path)).ok).toBe(true);
  });
});
