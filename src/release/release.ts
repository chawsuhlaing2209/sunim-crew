import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ComponentRow } from '../airtable/index.js';
import type { Config } from '../config/index.js';

const run = promisify(execFile);

/**
 * The release runs here, in the manager, and never in a worker.
 *
 * docs/security-checklist.md: "Workers never receive the publish keys (npm,
 * production deploy). Only the gated deploy step holds those, and only after
 * the human approves." A spawned worker would have to be handed the npm token
 * to publish, so there is no worker. This is a shell command, run once, by
 * the one process that already holds the key.
 */
export const RELEASE_TIMEOUT_MS = 20 * 60 * 1000;

export interface ReleaseStep {
  readonly name: string;
  readonly command: string;
  readonly ok: boolean;
  readonly output: string;
}

export interface ReleaseResult {
  readonly ok: boolean;
  readonly steps: readonly ReleaseStep[];
  readonly productionUrl: string | undefined;
  readonly npmUrl: string | undefined;
  readonly error: string | undefined;
}

/** The slug a component uses in a URL. */
export function slugOf(component: ComponentRow): string {
  return component.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const URL_PATTERN = /https?:\/\/[^\s<>"'()[\]]+/g;

/** The last URL a command printed, which is where deploy tools put it. */
export function lastUrlIn(output: string): string | undefined {
  const urls = [...output.matchAll(URL_PATTERN)].map((match) =>
    match[0].replace(/[.,;:]+$/, ''),
  );
  return urls[urls.length - 1];
}

export function productionUrlFor(
  config: Config,
  component: ComponentRow,
  output: string,
): string | undefined {
  const template = config.repo.productionUrlTemplate;
  return template === undefined
    ? lastUrlIn(output)
    : template.replace('{slug}', slugOf(component));
}

/** Where the published package can be read, for the record. */
export async function npmUrlFor(config: Config): Promise<string | undefined> {
  try {
    const text = await readFile(
      join(config.repo.pathOrUrl, 'package.json'),
      'utf8',
    );
    const parsed = JSON.parse(text) as { name?: unknown; version?: unknown };
    if (typeof parsed.name !== 'string') return undefined;

    const version =
      typeof parsed.version === 'string' ? parsed.version : undefined;
    const isDefault = config.npm.registry.includes('registry.npmjs.org');

    return isDefault
      ? `https://www.npmjs.com/package/${parsed.name}${version === undefined ? '' : `/v/${version}`}`
      : `${config.npm.registry.replace(/\/$/, '')}/${parsed.name}`;
  } catch {
    return undefined;
  }
}

export interface ReleaseDeps {
  /** Injected so a test can watch what would run without running it. */
  readonly exec?: (
    command: string,
    cwd: string,
    env: Record<string, string>,
  ) => Promise<{ ok: boolean; output: string }>;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

function shell(deps: ReleaseDeps) {
  return (
    deps.exec ??
    (async (command: string, cwd: string, env: Record<string, string>) => {
      try {
        const { stdout, stderr } = await run(command, {
          cwd,
          env,
          shell: true,
          timeout: RELEASE_TIMEOUT_MS,
          maxBuffer: 16 * 1024 * 1024,
        } as never);
        return { ok: true, output: `${String(stdout)}${String(stderr)}` };
      } catch (error) {
        const failure = error as { stdout?: string; stderr?: string };
        return {
          ok: false,
          output: `${failure.stdout ?? ''}${failure.stderr ?? ''}${String(error)}`,
        };
      }
    })
  );
}

/**
 * Deploy production, then publish. In that order: a package on the registry
 * cannot be unpublished cleanly, so it goes last, after the deploy that can
 * be rolled back has already worked.
 */
export async function release(
  component: ComponentRow,
  config: Config,
  deps: ReleaseDeps = {},
): Promise<ReleaseResult> {
  const parent = deps.env ?? process.env;
  const exec = shell(deps);
  const steps: ReleaseStep[] = [];

  const productionCommand = config.repo.productionCommand;
  if (productionCommand === undefined) {
    return {
      ok: false,
      steps,
      productionUrl: undefined,
      npmUrl: undefined,
      error:
        'no production command in config, so there is no way to deploy. Set repo.productionCommand.',
    };
  }

  if (config.npm.token === undefined) {
    return {
      ok: false,
      steps,
      productionUrl: undefined,
      npmUrl: undefined,
      error: 'no npm token, so the library cannot be published. Set NPM_TOKEN.',
    };
  }

  // The publish key exists in this environment and nowhere else.
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(parent)) {
    if (typeof value === 'string') env[key] = value;
  }
  env['NPM_TOKEN'] = config.npm.token;
  env['NPM_CONFIG_REGISTRY'] = config.npm.registry;

  const deploy = await exec(productionCommand, config.repo.pathOrUrl, env);
  steps.push({
    name: 'production',
    command: productionCommand,
    ok: deploy.ok,
    output: deploy.output,
  });

  if (!deploy.ok) {
    return {
      ok: false,
      steps,
      productionUrl: undefined,
      npmUrl: undefined,
      error: 'the production deploy failed, so nothing was published',
    };
  }

  const publish = await exec(
    config.npm.publishCommand,
    config.repo.pathOrUrl,
    env,
  );
  steps.push({
    name: 'publish',
    command: config.npm.publishCommand,
    ok: publish.ok,
    output: publish.output,
  });

  const productionUrl = productionUrlFor(config, component, deploy.output);

  if (!publish.ok) {
    return {
      ok: false,
      steps,
      productionUrl,
      npmUrl: undefined,
      error: 'production deployed, but the publish failed',
    };
  }

  return {
    ok: true,
    steps,
    productionUrl,
    npmUrl: await npmUrlFor(config),
    error: undefined,
  };
}
