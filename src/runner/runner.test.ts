import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readdirSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ALWAYS_DISALLOWED_TOOLS,
  FORBIDDEN_IN_CHILD,
  FAILURE_DETAIL_LIMIT,
  ForbiddenChildKeyError,
  buildArgs,
  childEnv,
  composePrompt,
  delegate,
  failureFrom,
  readFinal,
  runId,
} from './index.js';
import type { DelegateOptions, SpawnFn } from './index.js';

const OPTIONS: DelegateOptions = {
  label: 'Button implementation',
  brief: '# Engineer\n\nYou build one component.',
  task: 'Build Button from the design source.',
  cwd: '/tmp/design-system',
};

interface FakeChild extends EventEmitter {
  pid?: number;
  stdout: PassThrough;
  stderr: PassThrough;
  stdin: PassThrough;
  kill(signal?: NodeJS.Signals): boolean;
}

interface Spawned {
  command: string;
  args: string[];
  options: { cwd?: string; env?: Record<string, string>; detached?: boolean };
  child: FakeChild;
}

/** A stand in for the CLI, so no test spawns a real process. */
function fakeSpawn(): {
  spawn: SpawnFn;
  calls: Spawned[];
  signals: string[];
  spawned: () => Promise<FakeChild>;
} {
  const calls: Spawned[] = [];
  const signals: string[] = [];
  const waiting: ((child: FakeChild) => void)[] = [];

  const spawn = ((
    command: string,
    args: string[],
    options: { cwd?: string; env?: Record<string, string>; detached?: boolean },
  ) => {
    const child = Object.assign(new EventEmitter(), {
      pid: 4242,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      stdin: new PassThrough(),
      kill(signal?: NodeJS.Signals) {
        signals.push(signal ?? 'SIGTERM');
        return true;
      },
    }) as FakeChild;

    calls.push({ command, args, options, child });
    for (const resolve of waiting.splice(0)) resolve(child);
    return child;
  }) as unknown as SpawnFn;

  // delegate writes the prompt to disk before it spawns, so a test has to
  // wait for the spawn itself rather than for an arbitrary tick.
  const spawned = (): Promise<FakeChild> => {
    const first = calls[0]?.child;
    return first === undefined
      ? new Promise<FakeChild>((resolve) => waiting.push(resolve))
      : Promise.resolve(first);
  };

  return { spawn, calls, signals, spawned };
}

function resultLine(extra: Record<string, unknown> = {}): string {
  return `${JSON.stringify({
    type: 'result',
    subtype: 'success',
    result: 'Built Button. Commit https://github.com/owner/ds/commit/abc1234',
    session_id: 'session-1',
    total_cost_usd: 0.42,
    is_error: false,
    ...extra,
  })}\n`;
}

describe('the child environment', () => {
  const parent = {
    PATH: '/usr/bin',
    HOME: '/home/someone',
    ANTHROPIC_API_KEY: 'anthropic-key',
    AIRTABLE_TOKEN: 'airtable-token',
    NPM_TOKEN: 'npm-token',
    CHROMATIC_TOKEN: 'chromatic-token',
    AIRTABLE_BASE_ID: 'appAAAAAAAAAAAAAA',
    ASANA_TOKEN: 'asana-token',
    FIGMA_TOKEN: 'figma-token',
  };

  it('gives a worker nothing it was not offered, the API key included', () => {
    const env = childEnv(parent);

    // No key means the child authenticates the way the person running the
    // sweep does, through their own sign-in. A key left in a .env or
    // exported in a shell must not decide that for them.
    expect(env['ANTHROPIC_API_KEY']).toBeUndefined();
    expect(env['PATH']).toBe('/usr/bin');
    expect(env['ASANA_TOKEN']).toBeUndefined();
    expect(env['FIGMA_TOKEN']).toBeUndefined();
  });

  it('keeps every forbidden name out, even when the parent has it', () => {
    const env = childEnv(parent);

    for (const key of FORBIDDEN_IN_CHILD) {
      expect(env[key]).toBeUndefined();
    }
  });

  it('passes the API key when, and only when, a caller allows it', () => {
    expect(childEnv(parent)['ANTHROPIC_API_KEY']).toBeUndefined();
    expect(
      childEnv(parent, { allow: ['ANTHROPIC_API_KEY'] })['ANTHROPIC_API_KEY'],
    ).toBe('anthropic-key');
  });

  it('passes through what a worker was explicitly given', () => {
    const env = childEnv(parent, { allow: ['ASANA_TOKEN', 'FIGMA_TOKEN'] });

    expect(env['ASANA_TOKEN']).toBe('asana-token');
    expect(env['FIGMA_TOKEN']).toBe('figma-token');
    expect(env['AIRTABLE_TOKEN']).toBeUndefined();
  });

  it('refuses loudly when a caller asks for a forbidden name', () => {
    for (const key of FORBIDDEN_IN_CHILD) {
      expect(() => childEnv(parent, { allow: [key] })).toThrow(
        ForbiddenChildKeyError,
      );
      expect(() => childEnv(parent, { set: { [key]: 'sneaked in' } })).toThrow(
        ForbiddenChildKeyError,
      );
    }
  });
});

describe('the flags', () => {
  it('runs headless, isolated, and never stops to ask a person', () => {
    const args = buildArgs(OPTIONS);

    // --bare is off unless asked for: it refuses a subscription sign-in, and
    // the isolation that matters does not depend on it.
    expect(args).not.toContain('--bare');
    expect(buildArgs({ ...OPTIONS, bare: true })).toContain('--bare');
    expect(args).toContain('-p');
    expect(args).toContain('--strict-mcp-config');
    expect(args.join(' ')).toContain('--permission-mode dontAsk');
  });

  it('streams events, and asks for verbose because streaming needs it', () => {
    const args = buildArgs(OPTIONS).join(' ');

    expect(args).toContain('--output-format stream-json');
    expect(args).toContain('--verbose');
  });

  it('takes one JSON document instead when a shape is asked for', () => {
    const args = buildArgs({
      ...OPTIONS,
      jsonSchema: { type: 'object' },
    }).join(' ');

    expect(args).toContain('--output-format json');
    expect(args).not.toContain('stream-json');
    expect(args).toContain('--json-schema');
  });

  it('always denies the tools a worker has no business using', () => {
    const args = buildArgs({ ...OPTIONS, disallowedTools: ['Task'] });
    const denied = args[args.indexOf('--disallowedTools') + 1] ?? '';

    for (const tool of ALWAYS_DISALLOWED_TOOLS) {
      expect(denied).toContain(tool);
    }
    expect(denied).toContain('Task');
  });

  it('passes through the caller’s tools, dirs, model and budget', () => {
    const args = buildArgs({
      ...OPTIONS,
      allowedTools: ['Read', 'Edit', 'Bash(npm test *)'],
      addDirs: ['/tmp/tokens'],
      model: 'opus',
      maxBudgetUsd: 5,
    }).join(' ');

    expect(args).toContain('--allowedTools Read,Edit,Bash(npm test *)');
    expect(args).toContain('--add-dir /tmp/tokens');
    expect(args).toContain('--model opus');
    expect(args).toContain('--max-budget-usd 5');
  });
});

describe('composePrompt', () => {
  it('puts the craft first and this piece of work after it', () => {
    const prompt = composePrompt(OPTIONS);

    expect(prompt).toContain('# Engineer');
    expect(prompt.indexOf('# Engineer')).toBeLessThan(
      prompt.indexOf('Build Button'),
    );
    expect(prompt).toContain('# This delegation');
  });
});

describe('readFinal', () => {
  it('finds the result event at the end of a stream', () => {
    const stream = `${JSON.stringify({ type: 'system', subtype: 'init' })}\n${resultLine()}`;

    expect(readFinal(stream, 'stream-json').session_id).toBe('session-1');
  });

  it('reads one JSON document', () => {
    expect(readFinal(resultLine(), 'json').total_cost_usd).toBe(0.42);
  });

  it('returns nothing rather than guessing at noise', () => {
    expect(readFinal('not json at all', 'stream-json')).toEqual({});
    expect(readFinal('', 'json')).toEqual({});
  });
});

describe('runId', () => {
  it('makes a name that is safe on disk', () => {
    expect(runId('Button implementation', '2026-08-14T10-00-00')).toBe(
      '2026-08-14T10-00-00-button-implementation',
    );
  });
});

describe('delegate', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sunim-runner-'));
  });

  const options = (extra: Partial<DelegateOptions> = {}): DelegateOptions => ({
    ...OPTIONS,
    runDir: dir,
    ...extra,
  });

  it('writes the prompt to disk before the process starts', async () => {
    const fake = fakeSpawn();
    // Read the directory at the moment of the spawn, not after it finished.
    let promptOnDisk: string[] = [];
    const spawn = ((...args: Parameters<SpawnFn>) => {
      promptOnDisk = readdirSync(dir);
      return (fake.spawn as (...a: Parameters<SpawnFn>) => unknown)(
        ...args,
      ) as ReturnType<SpawnFn>;
    }) as SpawnFn;

    const run = delegate(options(), { spawn, stamp: () => 'stamp' });

    const child = await fake.spawned();
    child?.stdout.end(resultLine());
    child?.emit('close', 0, null);
    await run;

    expect(promptOnDisk).toContain('stamp-button-implementation.prompt.md');
    expect(
      await readFile(
        join(dir, 'stamp-button-implementation.prompt.md'),
        'utf8',
      ),
    ).toContain('Build Button');
  });

  it('streams what the child prints into a log', async () => {
    const fake = fakeSpawn();
    const run = delegate(options(), {
      spawn: fake.spawn,
      stamp: () => 'stamp',
    });
    const child = await fake.spawned();
    child?.stdout.write(`${JSON.stringify({ type: 'system' })}\n`);
    child?.stderr.write('a warning\n');
    child?.stdout.end(resultLine());
    child?.emit('close', 0, null);

    const result = await run;
    const log = await readFile(result.logPath, 'utf8');

    expect(log).toContain('--strict-mcp-config');
    expect(log).toContain('"type":"system"');
    expect(log).toContain('a warning');
  });

  it('reports the answer, the session and the cost', async () => {
    const fake = fakeSpawn();
    const run = delegate(options(), {
      spawn: fake.spawn,
      stamp: () => 'stamp',
    });
    const child = await fake.spawned();
    child?.stdout.end(resultLine());
    child?.emit('close', 0, null);

    const result = await run;

    expect(result.ok).toBe(true);
    expect(result.result).toContain('commit/abc1234');
    expect(result.sessionId).toBe('session-1');
    expect(result.costUsd).toBe(0.42);
  });

  it('runs in the repo, in its own process group', async () => {
    const fake = fakeSpawn();
    const run = delegate(options(), {
      spawn: fake.spawn,
      stamp: () => 'stamp',
    });
    const child = await fake.spawned();
    child?.stdout.end(resultLine());
    child?.emit('close', 0, null);
    await run;

    expect(fake.calls[0]?.options.cwd).toBe('/tmp/design-system');
    expect(fake.calls[0]?.options.detached).toBe(true);
  });

  it('gives the child an environment with no Airtable and no publish keys', async () => {
    const fake = fakeSpawn();
    const run = delegate(options({ allowEnv: ['ASANA_TOKEN'] }), {
      spawn: fake.spawn,
      stamp: () => 'stamp',
      env: {
        PATH: '/usr/bin',
        ANTHROPIC_API_KEY: 'anthropic-key',
        AIRTABLE_TOKEN: 'airtable-token',
        NPM_TOKEN: 'npm-token',
        ASANA_TOKEN: 'asana-token',
      },
    });
    const child = await fake.spawned();
    child?.stdout.end(resultLine());
    child?.emit('close', 0, null);
    await run;

    const env = fake.calls[0]?.options.env ?? {};
    expect(env['ANTHROPIC_API_KEY']).toBeUndefined();
    expect(env['ASANA_TOKEN']).toBe('asana-token');
    expect(env['AIRTABLE_TOKEN']).toBeUndefined();
    expect(env['NPM_TOKEN']).toBeUndefined();
  });

  it('kills the tree on a timeout, and says so', async () => {
    const fake = fakeSpawn();
    const killed: number[] = [];
    const realKill = process.kill.bind(process);
    process.kill = (pid: number) => {
      killed.push(pid);
      // Signal 0 on ourselves: proves nothing was actually killed.
      return realKill(process.pid, 0);
    };

    try {
      const run = delegate(options({ timeoutMs: 5 }), {
        spawn: fake.spawn,
        stamp: () => 'stamp',
      });

      const child = await fake.spawned();
      // Long enough for the 5ms timeout to fire and reach for the tree.
      await new Promise((resolve) => setTimeout(resolve, 30));
      child.stdout.end('');
      child.emit('close', null, 'SIGTERM');

      const result = await run;

      expect(result.timedOut).toBe(true);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('timed out');
      // Negative pid is the whole process group, not just the child.
      expect(killed).toContain(-4242);
      expect(await readFile(result.logPath, 'utf8')).toContain('timed out');
    } finally {
      process.kill = realKill;
    }
  });

  it('fails when the child exits non zero', async () => {
    const fake = fakeSpawn();
    const run = delegate(options(), {
      spawn: fake.spawn,
      stamp: () => 'stamp',
    });
    const child = await fake.spawned();
    child?.stdout.end('');
    child?.emit('close', 1, null);

    const result = await run;

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it('fails when the run itself errored, whatever the exit code', async () => {
    const fake = fakeSpawn();
    const run = delegate(options(), {
      spawn: fake.spawn,
      stamp: () => 'stamp',
    });
    const child = await fake.spawned();
    child?.stdout.end(
      resultLine({ is_error: true, subtype: 'error_max_turns' }),
    );
    child?.emit('close', 0, null);

    const result = await run;

    expect(result.ok).toBe(false);
  });

  it('reports why the run failed, in the worker’s own words', async () => {
    // What a real refusal looks like: the protocol finished, so subtype says
    // "success", and the run did not. Repeating the subtype back gives
    // "exit 1, success", which tells the operator nothing at all.
    const fake = fakeSpawn();
    const run = delegate(options(), { spawn: fake.spawn, stamp: () => 'x' });
    const child = await fake.spawned();
    child?.stdout.end(
      resultLine({
        is_error: true,
        subtype: 'success',
        terminal_reason: 'api_error',
        result: 'Credit balance is too low',
      }),
    );
    child?.emit('close', 1, null);

    const result = await run;

    expect(result.ok).toBe(false);
    expect(result.error).toBe('exit 1, Credit balance is too low');
  });

  it('falls back to why it ended when the worker said nothing', () => {
    expect(failureFrom({ terminal_reason: 'api_error' }, 1)).toBe(
      'exit 1, api_error',
    );
    // Nothing worth repeating. "exit 1, success" is worse than "exit 1".
    expect(failureFrom({ subtype: 'success' }, 1)).toBe('exit 1');
    expect(failureFrom({}, null)).toBe('exit null');
  });

  it('keeps a long refusal to one readable line', () => {
    const long = 'x'.repeat(FAILURE_DETAIL_LIMIT + 200);

    expect(failureFrom({ result: long }, 1).length).toBeLessThanOrEqual(
      FAILURE_DETAIL_LIMIT + 10,
    );
  });

  it('says so plainly when the CLI is not there', async () => {
    const result = await delegate(options(), {
      spawn: (() => {
        throw new Error('spawn claude ENOENT');
      }) as unknown as SpawnFn,
      stamp: () => 'stamp',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('ENOENT');
  });
});
