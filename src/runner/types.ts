/** One delegation: one worker, one craft, one process. */
export interface DelegateOptions {
  /** Names the run, the prompt file and the log. Kept short and readable. */
  readonly label: string;
  /**
   * Who is doing it, for the log. The label names one piece of work, this
   * names the agent across all of them, which is what a run of timeouts has
   * to be counted against.
   */
  readonly agent?: string;
  /** The brief, read from src/briefs, describing the craft. */
  readonly brief: string;
  /** What this particular delegation is about, composed by the manager. */
  readonly task: string;
  /** Where the worker runs. Normally the design system repo. */
  readonly cwd: string;
  /** Extra directories the worker may touch. */
  readonly addDirs?: readonly string[];
  /** Tools the worker may use without asking, in permission rule syntax. */
  readonly allowedTools?: readonly string[];
  /** Tools it may never use, whatever else says otherwise. */
  readonly disallowedTools?: readonly string[];
  /** Model alias or full name. Left to the CLI default when absent. */
  readonly model?: string;
  /** Hard ceiling in milliseconds. The tree is killed when it passes. */
  readonly timeoutMs?: number;
  /** A ceiling on spend for this one delegation. */
  readonly maxBudgetUsd?: number;
  /** MCP servers this worker needs, for example Figma for the engineer. */
  readonly mcpConfig?: string;
  /** Shape the worker's final answer must take. */
  readonly jsonSchema?: Readonly<Record<string, unknown>>;
  /** Environment names to pass through, never a forbidden one. */
  readonly allowEnv?: readonly string[];
  /** Where prompts and logs are written. */
  readonly runDir?: string;
}

export interface DelegateResult {
  readonly label: string;
  readonly ok: boolean;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly durationMs: number;
  /** The composed prompt, on disk before the process started. */
  readonly promptPath: string;
  /** Everything the child printed, as it printed it. */
  readonly logPath: string;
  /** The worker's final answer. */
  readonly result: string | undefined;
  /** Present when a jsonSchema was asked for and the worker obeyed it. */
  readonly structuredOutput: unknown;
  readonly sessionId: string | undefined;
  readonly costUsd: number | undefined;
  /** Why it failed, when it failed. */
  readonly error: string | undefined;
}
