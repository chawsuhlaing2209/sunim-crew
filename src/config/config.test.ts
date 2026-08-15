import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  EVIDENCE_FIELD_KEYS,
  FIELD_KEYS,
  FIELD_TABLE,
  FORMULA_FIELD_KEYS,
  OVERRIDES,
  OVERRIDE_KEYS,
  SECRET_KEYS,
  TABLE_KEYS,
  loadConfig,
  report,
  requireValue,
  slugFromRepo,
} from './index.js';

const secrets = {
  ANTHROPIC_API_KEY: 'test-anthropic-key',
  GITHUB_TOKEN: 'test-github-token',
  AIRTABLE_TOKEN: 'test-airtable-token',
  ASANA_TOKEN: 'test-asana-token',
  FIGMA_TOKEN: 'test-figma-token',
};

const project = {
  airtable: { baseId: 'appAAAAAAAAAAAAAA' },
  asana: { workspaceId: '1234567890', projectId: '9876543210' },
  repo: { pathOrUrl: 'https://github.com/someone/design-system.git' },
};

describe('loadConfig', () => {
  it('reads secrets from the environment and the rest from the file', () => {
    const config = loadConfig({ env: secrets, project });

    expect(config.anthropic.apiKey).toBe('test-anthropic-key');
    expect(config.airtable.baseId).toBe('appAAAAAAAAAAAAAA');
    expect(config.asana.projectId).toBe('9876543210');
    expect(config.repo.pathOrUrl).toBe(
      'https://github.com/someone/design-system.git',
    );
  });

  it('fills the table and field name map from the shipped base template', () => {
    const config = loadConfig({ env: secrets, project });

    expect(config.airtable.tables.components).toBe('Components');
    expect(config.airtable.tables.tests).toBe('Storybook Testing');
    expect(config.airtable.fields.commit).toBe('Commit');
    expect(config.airtable.fields.development).toBe('Development');
    expect(Object.keys(config.airtable.fields)).toEqual(FIELD_KEYS);
  });

  it('takes a base that names its fields differently', () => {
    const config = loadConfig({
      env: secrets,
      project: {
        ...project,
        airtable: {
          ...project.airtable,
          tables: { components: 'Parts' },
          fields: { commit: 'Git commit' },
        },
      },
    });

    expect(config.airtable.tables.components).toBe('Parts');
    // Untouched names keep the template default.
    expect(config.airtable.tables.tests).toBe('Storybook Testing');
    expect(config.airtable.fields.commit).toBe('Git commit');
    expect(config.airtable.fields.astro).toBe('Astro Link');
  });

  it('defaults the branch names and derives the repo slug', () => {
    const config = loadConfig({ env: secrets, project });

    expect(config.repo.stagingBranch).toBe('staging');
    expect(config.repo.mainBranch).toBe('main');
    expect(config.repo.slug).toBe('someone/design-system');
  });

  it('lets the environment override a file value', () => {
    const config = loadConfig({
      env: {
        ...secrets,
        AIRTABLE_BASE_ID: 'appBBBBBBBBBBBBBB',
        REPO_STAGING_BRANCH: 'preview',
      },
      project,
    });

    expect(config.airtable.baseId).toBe('appBBBBBBBBBBBBBB');
    expect(config.repo.stagingBranch).toBe('preview');
  });

  it('runs with no file at all when the environment carries everything', () => {
    const config = loadConfig({
      env: {
        ...secrets,
        AIRTABLE_BASE_ID: 'appAAAAAAAAAAAAAA',
        ASANA_WORKSPACE_ID: '1234567890',
        ASANA_PROJECT_ID: '9876543210',
        REPO_PATH_OR_URL: '/tmp/design-system',
      },
    });

    expect(config.airtable.baseId).toBe('appAAAAAAAAAAAAAA');
    expect(config.repo.pathOrUrl).toBe('/tmp/design-system');
    expect(config.repo.slug).toBeUndefined();
  });

  it('takes the whole name map from the environment, with no file', () => {
    const config = loadConfig({
      env: {
        ...secrets,
        AIRTABLE_BASE_ID: 'appAAAAAAAAAAAAAA',
        ASANA_WORKSPACE_ID: '1',
        ASANA_PROJECT_ID: '2',
        REPO_PATH_OR_URL: '/tmp/design-system',
        AIRTABLE_TABLE_TESTS: 'QA rows',
        AIRTABLE_FIELD_COMPONENT_LINK: 'Composed in',
        AIRTABLE_FIELD_COMMIT: 'Git commit',
      },
    });

    expect(config.airtable.tables.tests).toBe('QA rows');
    expect(config.airtable.fields.componentLink).toBe('Composed in');
    expect(config.airtable.fields.commit).toBe('Git commit');
    // Everything left alone keeps the template default.
    expect(config.airtable.fields.astro).toBe('Astro Link');
  });

  it('documents every name it accepts, in the file people actually read', async () => {
    // A setting the crew honours and the example file never mentions is a
    // setting nobody finds. FIGMA_MCP_URL was one of those, and not knowing
    // it existed sent a worker at a server that refuses the only credential
    // anybody has.
    const example = await readFile(
      fileURLToPath(new URL('../../.env.example', import.meta.url)),
      'utf8',
    );
    const undocumented = OVERRIDE_KEYS.filter((key) => !example.includes(key));

    expect(undocumented).toEqual([]);
  });

  it('documents every secret it reads, in the same file', async () => {
    const example = await readFile(
      fileURLToPath(new URL('../../.env.example', import.meta.url)),
      'utf8',
    );

    expect(SECRET_KEYS.filter((key) => !example.includes(key))).toEqual([]);
  });

  it('gives every table and field name an environment name', () => {
    for (const key of TABLE_KEYS) {
      expect(Object.values(OVERRIDES)).toContain(`airtable.tables.${key}`);
    }
    for (const key of FIELD_KEYS) {
      expect(Object.values(OVERRIDES)).toContain(`airtable.fields.${key}`);
    }
  });

  it('leaves the publish and visual test keys optional', () => {
    const config = loadConfig({ env: secrets, project });

    expect(config.npm.token).toBeUndefined();
    expect(config.chromatic.projectToken).toBeUndefined();
    expect(config.npm.registry).toBe('https://registry.npmjs.org');
  });

  it('runs with no Anthropic key, so workers use their own sign-in', () => {
    // A Claude subscription and API credit are two different meters. Handing
    // a worker a key puts it on the metered one, whatever the operator is
    // signed in to, so leaving the key out has to be a supported choice.
    const { ANTHROPIC_API_KEY: _omitted, ...rest } = secrets;
    const config = loadConfig({ env: rest, project });

    expect(config.anthropic.apiKey).toBeUndefined();
    expect(config.github.token).toBe('test-github-token');
  });

  it('says which one a worker will spend', () => {
    const { ANTHROPIC_API_KEY: _omitted, ...rest } = secrets;
    const on = (rows: ReturnType<typeof report>) =>
      rows.find((row) => row.name === 'workers run on')?.detail ?? '';

    expect(on(report({ env: secrets, project }))).toContain(
      'ANTHROPIC_API_KEY',
    );
    expect(on(report({ env: rest, project }))).toContain('subscription');
  });

  it('names a missing secret, and never a value', () => {
    const { AIRTABLE_TOKEN: _omitted, ...rest } = secrets;

    try {
      loadConfig({ env: rest, project });
      expect.unreachable('should have thrown');
    } catch (error) {
      const message = (error as ConfigError).message;
      expect(message).toContain('AIRTABLE_TOKEN is not set');
      expect(message).not.toContain('test-github-token');
    }
  });

  it('names a missing project value and the variable that can set it', () => {
    try {
      loadConfig({ env: secrets, project: { airtable: project.airtable } });
      expect.unreachable('should have thrown');
    } catch (error) {
      const message = (error as ConfigError).message;
      expect(message).toContain('asana.workspaceId is not set');
      expect(message).toContain('ASANA_WORKSPACE_ID');
      expect(message).toContain('repo.pathOrUrl is not set');
    }
  });

  it('reports every problem at once, not just the first', () => {
    try {
      loadConfig({ env: {}, project: {} });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ConfigError).problems.length).toBeGreaterThan(6);
    }
  });

  it('treats a mis-parsed comment as absent, not as a token', () => {
    // Node's --env-file leaves the inline comment on the last assignment in
    // a file. Believed literally, a fresh clone would think it can publish.
    const config = loadConfig({
      env: {
        ...secrets,
        NPM_TOKEN: '# npmjs.com > Access Tokens, publish scope',
        CHROMATIC_TOKEN: '   # chromatic.com > your project',
      },
      project,
    });

    expect(config.npm.token).toBeUndefined();
    expect(config.chromatic.projectToken).toBeUndefined();
  });

  it('treats an empty value as absent, in the file and the environment', () => {
    expect(() =>
      loadConfig({ env: { ...secrets, ASANA_TOKEN: '   ' }, project }),
    ).toThrow(/ASANA_TOKEN is not set/);

    expect(() =>
      loadConfig({
        env: secrets,
        project: { ...project, repo: { pathOrUrl: '' } },
      }),
    ).toThrow(/repo\.pathOrUrl is not set/);
  });

  it('rejects values of the wrong shape', () => {
    expect(() =>
      loadConfig({
        env: secrets,
        project: { ...project, airtable: { baseId: 'nope' } },
      }),
    ).toThrow(/airtable\.baseId/);

    expect(() =>
      loadConfig({
        env: secrets,
        project: { ...project, repo: { pathOrUrl: './relative' } },
      }),
    ).toThrow(/repo\.pathOrUrl must be an absolute path or a git url/);
  });

  it('returns a frozen config', () => {
    const config = loadConfig({ env: secrets, project });

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.airtable.fields)).toBe(true);
  });
});

describe('the field map', () => {
  it('places every field on a table', () => {
    for (const key of FIELD_KEYS) {
      expect(FIELD_TABLE[key]).toBeDefined();
    }
  });

  it('keeps the formula fields out of the evidence fields', () => {
    for (const key of FORMULA_FIELD_KEYS) {
      expect(EVIDENCE_FIELD_KEYS).not.toContain(key);
    }
  });
});

describe('slugFromRepo', () => {
  it('reads owner/repo out of a GitHub url', () => {
    expect(slugFromRepo('https://github.com/owner/repo.git')).toBe(
      'owner/repo',
    );
    expect(slugFromRepo('git@github.com:owner/repo.git')).toBe('owner/repo');
  });

  it('returns nothing for a local path', () => {
    expect(slugFromRepo('/tmp/design-system')).toBeUndefined();
  });
});

describe('requireValue', () => {
  it('throws when a step needs a value that is not set', () => {
    expect(() => requireValue(undefined, 'NPM_TOKEN', 'publishing')).toThrow(
      /NPM_TOKEN is not set, and publishing needs it/,
    );
  });

  it('returns the value when it is there', () => {
    expect(requireValue('npm-token', 'NPM_TOKEN', 'publishing')).toBe(
      'npm-token',
    );
  });
});

describe('report', () => {
  it('masks secrets and marks what came from the environment', () => {
    const rows = report({
      env: { ...secrets, AIRTABLE_BASE_ID: 'appBBBBBBBBBBBBBB' },
      project,
    });
    const row = (name: string) => rows.find((entry) => entry.name === name);

    expect(row('ANTHROPIC_API_KEY')?.detail).toMatch(/^set, \d+ characters$/);
    expect(row('ANTHROPIC_API_KEY')?.detail).not.toContain('test-anthropic');
    expect(row('NPM_TOKEN')?.state).toBe('missing');
    expect(row('airtable.baseId')?.detail).toBe(
      'appBBBBBBBBBBBBBB (from the environment)',
    );
    expect(row('asana.projectId')?.detail).toBe('9876543210');
  });
});
