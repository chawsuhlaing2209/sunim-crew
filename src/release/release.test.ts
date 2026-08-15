import { describe, expect, it } from 'vitest';
import type { ComponentRow } from '../airtable/index.js';
import { loadConfig } from '../config/index.js';
import type { Config } from '../config/index.js';
import { lastUrlIn, release, slugOf } from './index.js';

function makeConfig(extra: Record<string, string> = {}): Config {
  return loadConfig({
    env: {
      ANTHROPIC_API_KEY: 'x',
      GITHUB_TOKEN: 'x',
      AIRTABLE_TOKEN: 'x',
      ASANA_TOKEN: 'x',
      FIGMA_TOKEN: 'x',
      AIRTABLE_BASE_ID: 'appAAAAAAAAAAAAAA',
      ASANA_WORKSPACE_ID: '1',
      ASANA_PROJECT_ID: '2',
      REPO_PATH_OR_URL: '/tmp/design-system',
      REPO_PRODUCTION_COMMAND: 'npm run deploy:production',
      NPM_TOKEN: 'npm-secret',
      ...extra,
    },
  });
}

function component(): ComponentRow {
  return {
    id: 'recButton',
    name: 'Button group',
    status: 'To be deployed',
    statusRaw: 'To be deployed',
    figma: undefined,
    design: undefined,
    commit: 'https://github.com/o/r/commit/abc1234',
    storybook: 'https://staging.example.com/sb/',
    stagingUrl: undefined,
    productionUrl: undefined,
    astro: undefined,
    totalTests: 4,
    passedTests: 4,
    synchronization: undefined,
  };
}

interface Ran {
  command: string;
  cwd: string;
  env: Record<string, string>;
}

function fakeShell(
  answers: { ok: boolean; output: string }[] = [
    {
      ok: true,
      output: 'Deployed to https://ds.example.com/components/button-group',
    },
    { ok: true, output: '+ @sunim/ds@1.2.0' },
  ],
) {
  const ran: Ran[] = [];
  return {
    ran,
    exec: (command: string, cwd: string, env: Record<string, string>) => {
      ran.push({ command, cwd, env });
      return Promise.resolve(
        answers[ran.length - 1] ?? { ok: true, output: '' },
      );
    },
  };
}

describe('slugOf and lastUrlIn', () => {
  it('slugs a component name', () => {
    expect(slugOf(component())).toBe('button-group');
  });

  it('takes the last URL a command printed', () => {
    expect(
      lastUrlIn(
        'building...\nhttps://old.example.com\nLive: https://new.example.com.',
      ),
    ).toBe('https://new.example.com');
  });
});

describe('release', () => {
  it('deploys production first, then publishes', async () => {
    const shell = fakeShell();

    const result = await release(component(), makeConfig(), {
      exec: shell.exec,
      env: { PATH: '/usr/bin' },
    });

    expect(result.ok).toBe(true);
    expect(shell.ran.map((entry) => entry.command)).toEqual([
      'npm run deploy:production',
      'npm publish',
    ]);
  });

  it('runs in the design system repo, holding the publish key', async () => {
    const shell = fakeShell();

    await release(component(), makeConfig(), {
      exec: shell.exec,
      env: { PATH: '/usr/bin' },
    });

    expect(shell.ran[0]?.cwd).toBe('/tmp/design-system');
    // The key is here, in the manager, and nowhere else.
    expect(shell.ran[1]?.env['NPM_TOKEN']).toBe('npm-secret');
  });

  it('will not publish when the deploy failed', async () => {
    const shell = fakeShell([{ ok: false, output: 'deploy exploded' }]);

    const result = await release(component(), makeConfig(), {
      exec: shell.exec,
      env: {},
    });

    expect(result.ok).toBe(false);
    expect(shell.ran).toHaveLength(1);
    expect(result.error).toContain('nothing was published');
  });

  it('says so when the publish failed after a good deploy', async () => {
    const shell = fakeShell([
      { ok: true, output: 'https://ds.example.com/components/button-group' },
      { ok: false, output: '403 Forbidden' },
    ]);

    const result = await release(component(), makeConfig(), {
      exec: shell.exec,
      env: {},
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('the publish failed');
    expect(result.productionUrl).toContain('button-group');
  });

  it('refuses to run at all with no production command', async () => {
    const shell = fakeShell();
    const config = loadConfig({
      env: {
        ANTHROPIC_API_KEY: 'x',
        GITHUB_TOKEN: 'x',
        AIRTABLE_TOKEN: 'x',
        ASANA_TOKEN: 'x',
        FIGMA_TOKEN: 'x',
        AIRTABLE_BASE_ID: 'appAAAAAAAAAAAAAA',
        ASANA_WORKSPACE_ID: '1',
        ASANA_PROJECT_ID: '2',
        REPO_PATH_OR_URL: '/tmp/design-system',
        NPM_TOKEN: 'npm-secret',
      },
    });

    const result = await release(component(), config, { exec: shell.exec });

    expect(result.ok).toBe(false);
    expect(shell.ran).toHaveLength(0);
    expect(result.error).toContain('no production command');
  });

  it('refuses to run at all with no npm token', async () => {
    const shell = fakeShell();
    const config = loadConfig({
      env: {
        ANTHROPIC_API_KEY: 'x',
        GITHUB_TOKEN: 'x',
        AIRTABLE_TOKEN: 'x',
        ASANA_TOKEN: 'x',
        FIGMA_TOKEN: 'x',
        AIRTABLE_BASE_ID: 'appAAAAAAAAAAAAAA',
        ASANA_WORKSPACE_ID: '1',
        ASANA_PROJECT_ID: '2',
        REPO_PATH_OR_URL: '/tmp/design-system',
        REPO_PRODUCTION_COMMAND: 'npm run deploy:production',
      },
    });

    const result = await release(component(), config, { exec: shell.exec });

    expect(result.ok).toBe(false);
    expect(shell.ran).toHaveLength(0);
    expect(result.error).toContain('no npm token');
  });

  it('uses the URL template when config names one', async () => {
    const shell = fakeShell();

    const result = await release(
      component(),
      makeConfig({
        REPO_PRODUCTION_URL_TEMPLATE: 'https://ds.example.com/c/{slug}',
      }),
      { exec: shell.exec, env: {} },
    );

    expect(result.productionUrl).toBe('https://ds.example.com/c/button-group');
  });

  it('reads the URL out of the deploy output when there is no template', async () => {
    const shell = fakeShell();

    const result = await release(component(), makeConfig(), {
      exec: shell.exec,
      env: {},
    });

    expect(result.productionUrl).toBe(
      'https://ds.example.com/components/button-group',
    );
  });
});
