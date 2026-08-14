import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fail, inconclusive, pass } from './types.js';
import type { Result } from './types.js';

/** Source that can hold a colour. Token sources themselves are not scanned. */
export const SCANNED_EXTENSIONS: ReadonlySet<string> = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.astro',
  '.svelte',
  '.vue',
  '.html',
]);

const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  'storybook-static',
]);

/** #fff, #ffffff, #ffffffcc. Not #app, not #1 in a URL fragment. */
const RAW_HEX = /#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b/gi;

/** A line that says so is left alone, for the rare place a literal is right. */
const ALLOW = /sunim-allow-raw-hex/;

export interface HexFinding {
  readonly file: string;
  readonly line: number;
  readonly match: string;
  readonly text: string;
}

async function walk(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      files.push(...(await walk(full)));
    } else if (entry.isFile() && SCANNED_EXTENSIONS.has(extname(entry.name))) {
      files.push(full);
    }
  }

  return files;
}

export function findHex(source: string, file: string): HexFinding[] {
  const findings: HexFinding[] = [];

  source.split(/\r?\n/).forEach((text, index) => {
    if (ALLOW.test(text)) return;
    for (const match of text.matchAll(RAW_HEX)) {
      findings.push({
        file,
        line: index + 1,
        match: match[0],
        text: text.trim().slice(0, 120),
      });
    }
  });

  return findings;
}

/**
 * Does every colour come from a token. A raw hex in a component is a value
 * that will not follow the theme, so it is a hard no, and the finding names
 * the file and line rather than making anyone go looking.
 */
export async function tokenClean(sourcePath: string): Promise<Result> {
  let files: string[];
  try {
    const info = await stat(sourcePath);
    files = info.isDirectory()
      ? await walk(sourcePath)
      : SCANNED_EXTENSIONS.has(extname(sourcePath))
        ? [sourcePath]
        : [];
  } catch (error) {
    return inconclusive(`could not read ${sourcePath}: ${String(error)}`, {
      sourcePath,
    });
  }

  if (files.length === 0) {
    return fail('nothing to scan, no source files found', { sourcePath });
  }

  const findings: HexFinding[] = [];
  for (const file of files) {
    let source: string;
    try {
      source = await readFile(file, 'utf8');
    } catch (error) {
      return inconclusive(`could not read ${file}: ${String(error)}`, {
        sourcePath,
      });
    }
    findings.push(...findHex(source, relative(sourcePath, file) || file));
  }

  const seen = {
    sourcePath,
    filesScanned: files.length,
    ...(findings.length === 0 ? {} : { findings }),
  };

  return findings.length === 0
    ? pass(`no raw hex in ${files.length} files`, seen)
    : fail(
        `${findings.length} raw hex values, first at ${findings[0]?.file}:${findings[0]?.line} ${findings[0]?.match}`,
        seen,
      );
}
