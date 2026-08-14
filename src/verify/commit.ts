import { fail, inconclusive, pass } from './types.js';
import type { FetchDeps, Result } from './types.js';

export interface CommitTarget {
  readonly owner: string;
  readonly repo: string;
  readonly sha: string;
}

/** Read owner, repo and sha out of the URL a worker reported. */
export function parseCommitUrl(url: string): CommitTarget | undefined {
  const patterns = [
    /^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/commits?\/([0-9a-f]{7,40})\b/i,
    /^https?:\/\/api\.github\.com\/repos\/([^/\s]+)\/([^/\s]+)\/commits\/([0-9a-f]{7,40})\b/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(url.trim());
    if (
      match?.[1] !== undefined &&
      match[2] !== undefined &&
      match[3] !== undefined
    ) {
      return { owner: match[1], repo: match[2], sha: match[3].toLowerCase() };
    }
  }
  return undefined;
}

/**
 * Does this commit exist on GitHub. The one check that stands between a
 * worker saying it built something and the status moving.
 *
 * A 404 is a failure: the commit is not there. A 401, a 403 or a dead network
 * is inconclusive: our token is the problem, not the worker's claim.
 */
export async function commitResolves(
  url: string,
  token: string,
  deps: FetchDeps = {},
): Promise<Result> {
  const target = parseCommitUrl(url);
  if (target === undefined) {
    return fail('not a GitHub commit URL', { url });
  }

  const { owner, repo, sha } = target;
  const api = `https://api.github.com/repos/${owner}/${repo}/commits/${sha}`;
  const seen = { url, repo: `${owner}/${repo}`, sha };
  const get = deps.fetch ?? fetch;

  let response: Response;
  try {
    response = await get(api, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } catch (error) {
    return inconclusive(`could not reach GitHub: ${String(error)}`, seen);
  }

  // 404 is a repo the token cannot see or that is not there. 422 is what
  // GitHub answers for a well formed sha that is not in the repo, which is
  // exactly the shape of an invented commit. Both mean the claim is not true.
  if (response.status === 404 || response.status === 422) {
    return fail(
      response.status === 422
        ? 'commit does not resolve, no such commit in the repo'
        : `commit does not resolve, GitHub returned 404 for ${owner}/${repo}. If the repo is private, check the token can read it`,
      { ...seen, status: response.status },
    );
  }

  if (response.status === 401 || response.status === 403) {
    return inconclusive(
      `GitHub refused the token, ${response.status}. Check GITHUB_TOKEN can read ${owner}/${repo}`,
      { ...seen, status: response.status },
    );
  }

  if (!response.ok) {
    return inconclusive(`GitHub returned ${response.status}`, {
      ...seen,
      status: response.status,
    });
  }

  const body = (await response.json().catch(() => ({}))) as { sha?: unknown };
  const fullSha = typeof body.sha === 'string' ? body.sha : undefined;

  if (fullSha !== undefined && !fullSha.startsWith(sha)) {
    return fail('GitHub returned a different commit than the one reported', {
      ...seen,
      status: 200,
      returnedSha: fullSha,
    });
  }

  return pass(`commit ${sha.slice(0, 7)} resolves in ${owner}/${repo}`, {
    ...seen,
    status: 200,
    ...(fullSha === undefined ? {} : { sha: fullSha }),
  });
}
