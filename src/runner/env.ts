/**
 * What a worker is allowed to hold.
 *
 * A worker does one craft and reports. It never touches Airtable, because
 * status is derived from evidence the manager verifies, and it never holds a
 * publish key, because publishing is gated on a human. Rather than trusting a
 * brief to say so, the child process is built from an allowlist: anything not
 * named here simply is not in its environment.
 */

/** Never reaches a child, whatever the caller asks for. */
export const FORBIDDEN_IN_CHILD: readonly string[] = [
  // Airtable holds the status. A worker with this token could write evidence.
  'AIRTABLE_TOKEN',
  // The publish keys. Only the gated deploy step holds these.
  'NPM_TOKEN',
  'CHROMATIC_TOKEN',
  // Not a secret, but a worker has no business addressing the base at all.
  'AIRTABLE_BASE_ID',
];

/** Passed through so the child can run at all. */
export const SYSTEM_PASSTHROUGH: readonly string[] = [
  'PATH',
  'HOME',
  'SHELL',
  'USER',
  'LANG',
  'LC_ALL',
  'TMPDIR',
  'TERM',
  'NODE_OPTIONS',
  'SSH_AUTH_SOCK',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
];

export class ForbiddenChildKeyError extends Error {
  readonly key: string;

  constructor(key: string) {
    super(
      `Refusing to give a worker ${key}. A worker never writes status and never holds a publish key. If a step needs it, that step runs in the manager, behind the human gate.`,
    );
    this.name = 'ForbiddenChildKeyError';
    this.key = key;
  }
}

export interface ChildEnvOptions {
  /**
   * Extra names to pass through, for a worker that genuinely needs them, for
   * example ASANA_TOKEN so it can report into its own subtask, or FIGMA_TOKEN
   * so the engineer can read the design. Never a forbidden name.
   */
  readonly allow?: readonly string[];
  /** Values set directly on the child, not read from the parent. */
  readonly set?: Readonly<Record<string, string>>;
}

/**
 * Build the child's environment from nothing, adding only what is allowed.
 * Throws rather than silently dropping a forbidden name, so a mistake in a
 * caller is loud at the call site instead of quiet at runtime.
 */
export function childEnv(
  parent: Readonly<Record<string, string | undefined>>,
  options: ChildEnvOptions = {},
): Record<string, string> {
  const forbidden = new Set(FORBIDDEN_IN_CHILD);

  for (const key of [
    ...(options.allow ?? []),
    ...Object.keys(options.set ?? {}),
  ]) {
    if (forbidden.has(key)) throw new ForbiddenChildKeyError(key);
  }

  const out: Record<string, string> = {};
  const take = (key: string): void => {
    const value = parent[key];
    if (typeof value === 'string' && value !== '') out[key] = value;
  };

  for (const key of SYSTEM_PASSTHROUGH) take(key);
  // The worker spends its own key. This is the one secret it always needs.
  take('ANTHROPIC_API_KEY');
  for (const key of options.allow ?? []) take(key);

  for (const [key, value] of Object.entries(options.set ?? {})) {
    out[key] = value;
  }

  for (const key of forbidden) delete out[key];
  return out;
}
