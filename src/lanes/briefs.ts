import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export type BriefName = 'engineer' | 'qa' | 'devops';

/**
 * The briefs ship beside the code, and the build copies them into dist, so
 * this resolves the same way from source and from a built package.
 */
export function briefPath(name: BriefName): string {
  return join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'briefs',
    `${name}.md`,
  );
}

export async function readBrief(name: BriefName): Promise<string> {
  return await readFile(briefPath(name), 'utf8');
}
