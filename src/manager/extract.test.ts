import { describe, expect, it } from 'vitest';
import {
  extractCommitUrl,
  extractDeployedLink,
  extractLink,
  isCodeHostLink,
  urlsIn,
} from './extract.js';

/**
 * The report that got through, kept as it was written.
 *
 * DevOps is asked for the staging link and then the pull request URL, in that
 * order, so "the last URL wins" wrote the pull request into the Storybook
 * field. The check then fetched it, GitHub answered 200 as it always will,
 * and the component moved to Ready for Testing with QA pointed at a pull
 * request. Verified, and wrong, which is the only kind of wrong this design
 * is built to stop.
 */
const STAGE_REPORT = [
  'DevOps, via the crew.',
  '',
  'Staging: https://chawsuhlaing2209.github.io/sunim-ds/staging/storybook/',
  'Pull request: https://github.com/chawsuhlaing2209/sunim-ds/pull/1, merged.',
  '',
  'Deployed from staging at 7027a99. No conflicts.',
  'Result: staged',
].join('\n');

describe('urlsIn', () => {
  it('keeps the order and drops a trailing full stop', () => {
    expect(
      urlsIn('see https://example.com/a. and https://example.com/b'),
    ).toEqual(['https://example.com/a', 'https://example.com/b']);
  });
});

describe('extractCommitUrl', () => {
  it('takes only something shaped like a commit', () => {
    expect(
      extractCommitUrl(
        'pr https://github.com/o/r/pull/1 commit https://github.com/o/r/commit/abc1234',
      ),
    ).toBe('https://github.com/o/r/commit/abc1234');
  });
});

describe('isCodeHostLink', () => {
  it('knows a page on the code host from a deployed page', () => {
    expect(isCodeHostLink('https://github.com/o/r/pull/1')).toBe(true);
    expect(isCodeHostLink('https://github.com/o/r/commit/abc')).toBe(true);
    expect(isCodeHostLink('https://github.com/o/r/actions/runs/1')).toBe(true);
    // A GitHub Pages site is a deployed page that happens to be hosted there.
    expect(isCodeHostLink('https://owner.github.io/r/staging/storybook/')).toBe(
      false,
    );
    expect(isCodeHostLink('https://staging.example.com/sb/')).toBe(false);
  });
});

describe('extractDeployedLink', () => {
  it('takes the staging link, not the pull request that followed it', () => {
    expect(extractDeployedLink(STAGE_REPORT, { label: 'Staging' })).toBe(
      'https://chawsuhlaing2209.github.io/sunim-ds/staging/storybook/',
    );
  });

  it('and the old rule would have taken the wrong one', () => {
    // Kept as the record of what went wrong, so nobody restores that
    // behaviour thinking it was harmless.
    expect(extractLink(STAGE_REPORT)).toBe(
      'https://github.com/chawsuhlaing2209/sunim-ds/pull/1',
    );
  });

  it('skips a code host link even when the label is missing', () => {
    const unlabelled = [
      'Deployed it. The preview is https://staging.example.com/sb/',
      'and the pull request is https://github.com/o/r/pull/9',
    ].join('\n');

    expect(extractDeployedLink(unlabelled)).toBe(
      'https://staging.example.com/sb/',
    );
  });

  it('ignores a label pointing at a code host, rather than trusting it', () => {
    // A worker that labels the wrong thing does not get to write the wrong
    // thing. The label decides which link is meant, not whether it counts.
    const mislabelled = [
      'Staging: https://github.com/o/r/pull/9',
      'Also https://staging.example.com/sb/',
    ].join('\n');

    expect(extractDeployedLink(mislabelled, { label: 'Staging' })).toBe(
      'https://staging.example.com/sb/',
    );
  });

  it('finds nothing when every link is a code host link', () => {
    expect(
      extractDeployedLink('https://github.com/o/r/pull/9', {
        label: 'Staging',
      }),
    ).toBeUndefined();
  });

  it('still honours mustContain', () => {
    const report = [
      'Page: https://docs.example.com/components/button',
      'Storybook: https://docs.example.com/storybook/',
    ].join('\n');

    expect(extractDeployedLink(report, { mustContain: 'components' })).toBe(
      'https://docs.example.com/components/button',
    );
  });
});
