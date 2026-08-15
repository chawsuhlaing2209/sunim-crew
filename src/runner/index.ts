export {
  DEFAULT_TIMEOUT_MS,
  FAILURE_DETAIL_LIMIT,
  KILL_GRACE_MS,
  composePrompt,
  delegate,
  failureFrom,
  readFinal,
  runId,
} from './delegate.js';
export type { DelegateDeps, SpawnFn } from './delegate.js';

export {
  HaltedError,
  TIMEOUT_STRIKES,
  agentOf,
  describeDelegation,
  describeFlag,
  fileJournal,
  memoryJournal,
  repeatedTimeouts,
  watch,
  willRepeat,
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
