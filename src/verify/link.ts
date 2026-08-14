import { fail, inconclusive, pass } from './types.js';
import type { FetchDeps, Result } from './types.js';

export interface LinkResponse {
  readonly status: number;
  readonly finalUrl: string;
  readonly body: string;
}

/**
 * Fetch a page once and hand back what came off the wire, so a caller that
 * needs the body does not pay for a second request.
 */
export async function readPage(
  url: string,
  deps: FetchDeps = {},
): Promise<LinkResponse | { error: string }> {
  const get = deps.fetch ?? fetch;
  try {
    const response = await get(url, { redirect: 'follow' });
    return {
      status: response.status,
      finalUrl: response.url === '' ? url : response.url,
      body: await response.text().catch(() => ''),
    };
  } catch (error) {
    return { error: String(error) };
  }
}

/**
 * Is this link live. A staging Storybook that does not answer is not evidence,
 * so a component never reaches Ready for Testing on a link nobody can open.
 */
export async function linkLives(
  url: string,
  deps: FetchDeps = {},
): Promise<Result> {
  if (!/^https?:\/\/\S+$/.test(url.trim())) {
    return fail('not an http or https URL', { url });
  }

  const response = await readPage(url, deps);
  if ('error' in response) {
    return inconclusive(`could not reach the link: ${response.error}`, { url });
  }

  const seen = {
    url,
    status: response.status,
    ...(response.finalUrl === url ? {} : { finalUrl: response.finalUrl }),
  };

  return response.status === 200
    ? pass(`link returns 200`, seen)
    : fail(`link returns ${response.status}, not 200`, seen);
}
