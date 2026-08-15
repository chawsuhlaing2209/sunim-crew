import { parseCommitUrl } from '../verify/index.js';

const URL_PATTERN = /https?:\/\/[^\s<>"'()[\]]+/g;

/** Every URL in a worker's report, in the order it wrote them. */
export function urlsIn(text: string): string[] {
  return [...text.matchAll(URL_PATTERN)].map((match) =>
    // A URL at the end of a sentence should not carry the full stop.
    match[0].replace(/[.,;:]+$/, ''),
  );
}

/**
 * The commit a worker claims it pushed. Only a URL that is shaped like a
 * GitHub commit counts, so a link to a branch or a pull request does not get
 * mistaken for one. Nothing is verified here, that is the verify layer's job.
 */
export function extractCommitUrl(text: string): string | undefined {
  return urlsIn(text).find((url) => parseCommitUrl(url) !== undefined);
}

/**
 * The link a worker claims is live. The last one wins: a report often walks
 * through what it did and ends with the thing it wants read.
 */
export function extractLink(
  text: string,
  options: { readonly mustContain?: string } = {},
): string | undefined {
  const urls = urlsIn(text).filter(
    (url) =>
      options.mustContain === undefined ||
      url.toLowerCase().includes(options.mustContain.toLowerCase()),
  );
  return urls[urls.length - 1];
}

/**
 * A page on the code host. Never a deployed component, whatever it returns.
 *
 * This is the one that got through. A report is asked for the staging link
 * and the pull request URL, in that order, so "the last URL wins" wrote the
 * pull request into the Storybook field. Then the check fetched it, got a
 * perfectly healthy 200 from GitHub, and moved the component to Ready for
 * Testing with QA pointed at a pull request. Verified, and wrong.
 */
const CODE_HOST =
  /^https?:\/\/(?:www\.)?github\.com\/[^/]+\/[^/]+\/(?:pull|commit|compare|tree|blob|issues|releases|actions)\b/i;

export function isCodeHostLink(url: string): boolean {
  return CODE_HOST.test(url);
}

/**
 * The deployed page a worker is reporting, told apart from everything else it
 * mentioned.
 *
 * A labelled line wins, because the task asks for one and a label is the only
 * thing that says which link is meant rather than which came last. Failing
 * that, the last link that is not a page on the code host.
 */
export function extractDeployedLink(
  text: string,
  options: { readonly label?: string; readonly mustContain?: string } = {},
): string | undefined {
  const usable = (url: string): boolean =>
    !isCodeHostLink(url) &&
    (options.mustContain === undefined ||
      url.toLowerCase().includes(options.mustContain.toLowerCase()));

  if (options.label !== undefined) {
    const line = new RegExp(`^\\s*${options.label}\\s*:\\s*(\\S+)`, 'im').exec(
      text,
    );
    const labelled = line?.[1]?.replace(/[.,;:]+$/, '');
    if (labelled !== undefined && usable(labelled)) return labelled;
  }

  const urls = urlsIn(text).filter(usable);
  return urls[urls.length - 1];
}
