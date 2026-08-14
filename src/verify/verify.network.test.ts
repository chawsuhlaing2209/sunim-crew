import { describe, expect, it } from 'vitest';
import type { AirtableClient, TestRow } from '../airtable/index.js';
import {
  commitResolves,
  docsPageComplete,
  isInconclusive,
  linkLives,
  parseCommitUrl,
  testRowsReal,
} from './index.js';

/** A fetch that answers from a script, so no test touches the network. */
function fetchStub(
  answer: (url: string) => { status: number; body?: string } | Error,
): typeof fetch {
  return ((url: string | URL) => {
    const reply = answer(String(url));
    if (reply instanceof Error) return Promise.reject(reply);
    return Promise.resolve(
      new Response(reply.body ?? '', { status: reply.status }),
    );
  }) as typeof fetch;
}

const COMMIT_URL =
  'https://github.com/owner/design-system/commit/abc1234def5678901234567890abcdef12345678';

describe('parseCommitUrl', () => {
  it('reads the browser URL a worker would paste', () => {
    expect(parseCommitUrl(COMMIT_URL)).toEqual({
      owner: 'owner',
      repo: 'design-system',
      sha: 'abc1234def5678901234567890abcdef12345678',
    });
  });

  it('reads a short sha and an api URL', () => {
    expect(parseCommitUrl('https://github.com/o/r/commit/abc1234')?.sha).toBe(
      'abc1234',
    );
    expect(
      parseCommitUrl('https://api.github.com/repos/o/r/commits/abc1234')?.owner,
    ).toBe('o');
  });

  it('returns nothing for anything else', () => {
    expect(
      parseCommitUrl('https://example.com/commit/abc1234'),
    ).toBeUndefined();
    expect(parseCommitUrl('not a url')).toBeUndefined();
  });
});

describe('commitResolves', () => {
  it('passes when GitHub returns the commit', async () => {
    const result = await commitResolves(COMMIT_URL, 'token', {
      fetch: fetchStub(() => ({
        status: 200,
        body: JSON.stringify({
          sha: 'abc1234def5678901234567890abcdef12345678',
        }),
      })),
    });

    expect(result.ok).toBe(true);
    expect(result.evidence['repo']).toBe('owner/design-system');
    expect(result.evidence['status']).toBe(200);
  });

  it('calls the api, not the page a worker linked', async () => {
    let called = '';
    await commitResolves(COMMIT_URL, 'token', {
      fetch: fetchStub((url) => {
        called = url;
        return { status: 200, body: '{}' };
      }),
    });

    expect(called).toBe(
      'https://api.github.com/repos/owner/design-system/commits/abc1234def5678901234567890abcdef12345678',
    );
  });

  it('fails on a commit that does not exist', async () => {
    // GitHub answers 422 for a well formed sha that is not in the repo, and
    // 404 for a repo it will not show us. An invented commit is a failure,
    // not something to retry later.
    for (const status of [404, 422]) {
      const result = await commitResolves(COMMIT_URL, 'token', {
        fetch: fetchStub(() => ({ status })),
      });

      expect(result.ok).toBe(false);
      expect(isInconclusive(result)).toBe(false);
      expect(result.evidence['summary']).toContain('does not resolve');
    }
  });

  it('fails on a URL that is not a commit at all', async () => {
    const result = await commitResolves('https://example.com/nope', 'token', {
      fetch: fetchStub(() => ({ status: 200 })),
    });

    expect(result.ok).toBe(false);
    expect(result.evidence['summary']).toContain('not a GitHub commit URL');
  });

  it('fails when GitHub answers with a different commit', async () => {
    const result = await commitResolves(COMMIT_URL, 'token', {
      fetch: fetchStub(() => ({
        status: 200,
        body: JSON.stringify({
          sha: '9999999999999999999999999999999999999999',
        }),
      })),
    });

    expect(result.ok).toBe(false);
    expect(result.evidence['returnedSha']).toBe(
      '9999999999999999999999999999999999999999',
    );
  });

  it('says inconclusive when our token is the problem, not the claim', async () => {
    for (const status of [401, 403]) {
      const result = await commitResolves(COMMIT_URL, 'token', {
        fetch: fetchStub(() => ({ status })),
      });

      expect(result.ok).toBe(false);
      expect(isInconclusive(result)).toBe(true);
      expect(result.evidence['summary']).toContain('GITHUB_TOKEN');
    }
  });

  it('says inconclusive when the network is down', async () => {
    const result = await commitResolves(COMMIT_URL, 'token', {
      fetch: fetchStub(() => new Error('ENOTFOUND')),
    });

    expect(isInconclusive(result)).toBe(true);
  });
});

describe('linkLives', () => {
  it('passes on 200', async () => {
    const result = await linkLives('https://staging.example.com/storybook', {
      fetch: fetchStub(() => ({ status: 200 })),
    });

    expect(result.ok).toBe(true);
  });

  it('fails on anything else, and says what it got', async () => {
    for (const status of [404, 500, 301]) {
      const result = await linkLives('https://staging.example.com/storybook', {
        fetch: fetchStub(() => ({ status })),
      });

      expect(result.ok).toBe(false);
      expect(result.evidence['status']).toBe(status);
    }
  });

  it('fails a link that is not a URL, without a request', async () => {
    const result = await linkLives('coming soon', {
      fetch: fetchStub(() => {
        throw new Error('should not be called');
      }),
    });

    expect(result.ok).toBe(false);
  });

  it('says inconclusive when the host cannot be reached', async () => {
    const result = await linkLives('https://staging.example.com', {
      fetch: fetchStub(() => new Error('ECONNREFUSED')),
    });

    expect(isInconclusive(result)).toBe(true);
  });
});

function page(sections: string[]): string {
  return `<html><body><h1>Button</h1>${sections
    .map((section) => `<h2 id="x"><a href="#x">${section}</a></h2><p>text</p>`)
    .join('')}</body></html>`;
}

const ALL_SECTIONS = [
  'Overview',
  'When to use, when not',
  'Live example',
  'Props / API',
  'Variants and states',
  'Accessibility',
  'Tokens used',
  'Changelog',
];

describe('docsPageComplete', () => {
  it('passes a page with every required section', async () => {
    const result = await docsPageComplete('https://docs.example.com/button', {
      fetch: fetchStub(() => ({ status: 200, body: page(ALL_SECTIONS) })),
    });

    expect(result.ok).toBe(true);
    expect(result.evidence['sections']).toBe(8);
  });

  it('names the sections a page is missing', async () => {
    const result = await docsPageComplete('https://docs.example.com/button', {
      fetch: fetchStub(() => ({
        status: 200,
        body: page(['Overview', 'Live example', 'Accessibility']),
      })),
    });

    expect(result.ok).toBe(false);
    expect(result.evidence['missing']).toEqual([
      'When to use, when not',
      'Props / API',
      'Variants and states',
      'Tokens used',
      'Changelog',
    ]);
  });

  it('reads headings through the anchor links Starlight adds', async () => {
    const result = await docsPageComplete('https://docs.example.com/button', {
      fetch: fetchStub(() => ({
        status: 200,
        body: page(ALL_SECTIONS).replace(
          '<h2 id="x"><a href="#x">Overview</a></h2>',
          '<h2 id="overview"><a class="anchor" href="#overview"><span>Overview</span></a></h2>',
        ),
      })),
    });

    expect(result.ok).toBe(true);
  });

  it('fails a page that does not answer 200', async () => {
    const result = await docsPageComplete('https://docs.example.com/button', {
      fetch: fetchStub(() => ({ status: 404 })),
    });

    expect(result.ok).toBe(false);
    expect(result.evidence['summary']).toContain('404');
  });
});

function testClient(rows: TestRow[]): AirtableClient {
  return {
    listTestRows: () => Promise.resolve(rows),
  } as unknown as AirtableClient;
}

function row(overrides: Partial<TestRow> = {}): TestRow {
  return {
    id: 'recCase',
    name: 'Button, primary, hover',
    result: 'Passed',
    resultRaw: 'Passed',
    componentIds: ['recButton'],
    attachments: [
      { id: 'att1', url: 'https://example.com/shot.png', filename: 'shot.png' },
    ],
    ...overrides,
  };
}

describe('testRowsReal', () => {
  it('passes when every row has a result and a screenshot', async () => {
    const result = await testRowsReal(
      'recButton',
      testClient([
        row(),
        row({ id: 'r2', result: 'Failed', resultRaw: 'Failed' }),
      ]),
    );

    expect(result.ok).toBe(true);
    expect(result.evidence['rows']).toBe(2);
    expect(result.evidence['passed']).toBe(1);
    expect(result.evidence['failed']).toBe(1);
  });

  it('fails when there are no rows, which is QA claiming without testing', async () => {
    const result = await testRowsReal('recButton', testClient([]));

    expect(result.ok).toBe(false);
    expect(result.evidence['summary']).toContain('no test rows');
  });

  it('fails a row with no screenshot, and names it', async () => {
    const result = await testRowsReal(
      'recButton',
      testClient([row(), row({ id: 'r2', name: 'no shot', attachments: [] })]),
    );

    expect(result.ok).toBe(false);
    expect(result.evidence['withoutAttachment']).toEqual(['no shot']);
  });

  it('fails a row whose result the crew does not recognise', async () => {
    const result = await testRowsReal(
      'recButton',
      testClient([row({ result: undefined, resultRaw: 'Probably fine' })]),
    );

    expect(result.ok).toBe(false);
    expect(result.evidence['withoutResult']).toEqual([
      { name: 'Button, primary, hover', result: 'Probably fine' },
    ]);
  });

  it('fails when there are fewer rows than the contract expects', async () => {
    const result = await testRowsReal('recButton', testClient([row()]), {
      expected: 4,
    });

    expect(result.ok).toBe(false);
    expect(result.evidence['summary']).toContain('expects 4');
  });

  it('says inconclusive when Airtable cannot be read', async () => {
    const broken = {
      listTestRows: () => Promise.reject(new Error('rate limited')),
    } as unknown as AirtableClient;

    expect(isInconclusive(await testRowsReal('recButton', broken))).toBe(true);
  });
});
