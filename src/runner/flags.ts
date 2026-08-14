import type { DelegateOptions } from './types.js';

/**
 * The headless flags, read from `claude --help` on 2.1.227 and from
 * code.claude.com/docs/en/headless, not guessed. Re-run the build-day check
 * when the CLI updates: this file is the only place flags are named.
 *
 * --bare        the documented mode for scripted calls. No host hooks, no
 *               plugins, no MCP auto-discovery, no CLAUDE.md from the working
 *               directory. A teammate's local setup cannot change what a
 *               worker does. Auth is strictly ANTHROPIC_API_KEY.
 * -p            non-interactive. Reads the prompt from stdin.
 * --output-format stream-json
 *               newline delimited events, so the log fills as work happens
 *               rather than all at the end. Requires --verbose.
 * --permission-mode dontAsk
 *               nothing outside the allow rules and the read-only set runs.
 *               A worker cannot stop and wait for a person who is not there.
 * --strict-mcp-config
 *               only the servers we passed, ignoring anything on the machine.
 *
 * There is no --max-turns in this version. Depth is bounded by --max-budget-usd
 * and by the hard timeout in delegate().
 */
export const CLI_BINARY = 'claude';

export const BASE_FLAGS: readonly string[] = [
  '--bare',
  '-p',
  '--permission-mode',
  'dontAsk',
  '--strict-mcp-config',
];

/**
 * The docs pair --json-schema with --output-format json, not with stream-json,
 * so asking for a shaped answer trades the live stream for one JSON document
 * at the end. The log still gets everything the child printed either way.
 */
export function outputFormatFor(
  options: Pick<DelegateOptions, 'jsonSchema'>,
): 'json' | 'stream-json' {
  return options.jsonSchema === undefined ? 'stream-json' : 'json';
}

/** Never available to a worker, whatever a caller passes. */
export const ALWAYS_DISALLOWED_TOOLS: readonly string[] = [
  // A worker reports into its subtask. It does not go and look things up
  // elsewhere, and it does not reach the Airtable or npm APIs by hand.
  'WebFetch',
  'WebSearch',
];

export function buildArgs(options: DelegateOptions): string[] {
  const format = outputFormatFor(options);
  const args = [...BASE_FLAGS, '--output-format', format];

  // stream-json only emits events when --verbose is on.
  if (format === 'stream-json') args.push('--verbose');

  if (options.model !== undefined) args.push('--model', options.model);

  for (const dir of options.addDirs ?? []) args.push('--add-dir', dir);

  const allowed = options.allowedTools ?? [];
  if (allowed.length > 0) args.push('--allowedTools', allowed.join(','));

  const disallowed = [
    ...new Set([
      ...ALWAYS_DISALLOWED_TOOLS,
      ...(options.disallowedTools ?? []),
    ]),
  ];
  args.push('--disallowedTools', disallowed.join(','));

  if (options.mcpConfig !== undefined) {
    args.push('--mcp-config', options.mcpConfig);
  }

  if (options.maxBudgetUsd !== undefined) {
    args.push('--max-budget-usd', String(options.maxBudgetUsd));
  }

  if (options.jsonSchema !== undefined) {
    args.push('--json-schema', JSON.stringify(options.jsonSchema));
  }

  return args;
}
