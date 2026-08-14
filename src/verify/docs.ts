import { readPage } from './link.js';
import { fail, inconclusive, pass } from './types.js';
import type { FetchDeps, Result } from './types.js';

/**
 * The required sections, straight from docs/component-contract.md. Presence
 * only. Whether the writing is any good is a human call at the last gate.
 *
 * Each section accepts a few spellings, because a page that says
 * "Props and API" is not missing its props table.
 */
export const REQUIRED_SECTIONS = [
  { key: 'overview', label: 'Overview', match: /^overview$/ },
  {
    key: 'whenToUse',
    label: 'When to use, when not',
    match: /when\s+(to\s+use|not)/,
  },
  { key: 'liveExample', label: 'Live example', match: /^(live\s+)?example/ },
  { key: 'props', label: 'Props / API', match: /\bprops\b|\bapi\b/ },
  {
    key: 'variantsAndStates',
    label: 'Variants and states',
    match: /variants?|states?/,
  },
  {
    key: 'accessibility',
    label: 'Accessibility',
    match: /accessibility|a11y/,
  },
  { key: 'tokens', label: 'Tokens used', match: /tokens?/ },
  { key: 'changelog', label: 'Changelog', match: /changelog|version history/ },
] as const;

export type SectionKey = (typeof REQUIRED_SECTIONS)[number]['key'];

const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

/** Pull the heading text out of a rendered page, tags and anchors stripped. */
export function headings(html: string): string[] {
  const found: string[] = [];
  const pattern = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi;

  for (const match of html.matchAll(pattern)) {
    const inner = match[1] ?? '';
    const text = inner
      .replace(/<[^>]*>/g, ' ')
      .replace(
        /&[a-z#0-9]+;/gi,
        (entity) => ENTITIES[entity.toLowerCase()] ?? ' ',
      )
      .replace(/\s+/g, ' ')
      .trim();
    if (text !== '') found.push(text);
  }

  return found;
}

/**
 * Is the docs page there and structurally complete. Fetches once, checks the
 * page answers 200, then checks every required section has a heading.
 */
export async function docsPageComplete(
  url: string,
  deps: FetchDeps = {},
): Promise<Result> {
  if (!/^https?:\/\/\S+$/.test(url.trim())) {
    return fail('not an http or https URL', { url });
  }

  const response = await readPage(url, deps);
  if ('error' in response) {
    return inconclusive(`could not reach the docs page: ${response.error}`, {
      url,
    });
  }

  if (response.status !== 200) {
    return fail(`docs page returns ${response.status}, not 200`, {
      url,
      status: response.status,
    });
  }

  const found = headings(response.body);
  const normalised = found.map((heading) => heading.toLowerCase());

  const missing = REQUIRED_SECTIONS.filter(
    (section) => !normalised.some((heading) => section.match.test(heading)),
  ).map((section) => section.label);

  const seen = {
    url,
    status: 200,
    headings: found,
    sections: REQUIRED_SECTIONS.length - missing.length,
    of: REQUIRED_SECTIONS.length,
    ...(missing.length === 0 ? {} : { missing }),
  };

  return missing.length === 0
    ? pass(
        `docs page has all ${REQUIRED_SECTIONS.length} required sections`,
        seen,
      )
    : fail(
        `docs page is missing ${missing.length}: ${missing.join(', ')}`,
        seen,
      );
}
