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
