export {
  DEFAULT_TIMEOUT_MS,
  KILL_GRACE_MS,
  composePrompt,
  delegate,
  readFinal,
  runId,
} from './delegate.js';
export type { DelegateDeps, SpawnFn } from './delegate.js';

export {
  TIMEOUT_STRIKES,
  agentOf,
  describeDelegation,
  describeFlag,
  fileJournal,
  memoryJournal,
  repeatedTimeouts,
  watch,
} from './journal.js';
export type {
  Delegator,
  DelegationRecord,
  Journal,
  TimeoutFlag,
  WatchDeps,
  WatchedRunner,
} from './journal.js';

export {
  FORBIDDEN_IN_CHILD,
  ForbiddenChildKeyError,
  SYSTEM_PASSTHROUGH,
  childEnv,
} from './env.js';
export type { ChildEnvOptions } from './env.js';

export {
  ALWAYS_DISALLOWED_TOOLS,
  BASE_FLAGS,
  CLI_BINARY,
  buildArgs,
  outputFormatFor,
} from './flags.js';

export type { DelegateOptions, DelegateResult } from './types.js';
