/**
 * Every check answers the same two questions: did it pass, and what did you
 * see. The manager writes an evidence field only on ok, and logs the evidence
 * either way, so a refusal can be read back later without rerunning anything.
 */
export interface Evidence {
  /** One line, safe to put in an Asana comment or a log. */
  readonly summary: string;
  readonly [key: string]: unknown;
}

export interface Result {
  readonly ok: boolean;
  readonly evidence: Evidence;
}

export function pass(
  summary: string,
  extra: Readonly<Record<string, unknown>> = {},
): Result {
  return { ok: true, evidence: { ...extra, summary } };
}

export function fail(
  summary: string,
  extra: Readonly<Record<string, unknown>> = {},
): Result {
  return { ok: false, evidence: { ...extra, summary } };
}

/**
 * The check could not reach a verdict: the network was down, a token was
 * rejected, a file could not be read. Never ok, because unverified evidence
 * is never written, but marked apart from a real failure so the manager can
 * retry instead of flagging a worker who did nothing wrong.
 */
export function inconclusive(
  summary: string,
  extra: Readonly<Record<string, unknown>> = {},
): Result {
  return { ok: false, evidence: { ...extra, inconclusive: true, summary } };
}

/** Whether a result failed because it could not tell, rather than because it is false. */
export function isInconclusive(result: Result): boolean {
  return result.evidence['inconclusive'] === true;
}

export interface FetchDeps {
  readonly fetch?: typeof fetch;
}
