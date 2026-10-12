/**
 * Error codes (issue #86, finding 10): behaviour that used to depend on
 * matching error message text keys off `ApiErrorCode` instead, so wording
 * can change freely. Messages are unchanged.
 *
 * - The code rides on the error when it is thrown where the condition
 *   arises (e.g. `NoAgentError`), else it is derived once, here, from the
 *   status + message — the text matches that used to pick statuses in the
 *   actions dispatcher live in `errorCodeFor` and nowhere else.
 * - Every reader treats `code` as optional and falls back to the previous
 *   text match when it is absent (old clients, old stored errors).
 */
import type { FastifyReply } from "fastify";
import type { ApiErrorBody, ApiErrorCode } from "@unvibe/shared";

const CODES: ReadonlySet<string> = new Set([
  "not-found",
  "invalid-request",
  "no-agent",
  "head-moved",
  "not-implemented",
]);

export function isApiErrorCode(v: unknown): v is ApiErrorCode {
  return typeof v === "string" && CODES.has(v);
}

/** Code carried by a thrown error, when the throw site set one. */
export function errorCodeOf(err: unknown): ApiErrorCode | undefined {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  return isApiErrorCode(code) ? code : undefined;
}

const NOT_FOUND_TEXT =
  /unknown (review|repo|comment|card|annotation|follow-up|page|block|file|description|thread|second opinion)|no pending card/;
const NO_AGENT_TEXT = /no agent configured/;
const INVALID_TEXT = /required|must be|bad |invalid|no failed|cannot be retried|has a failed|different model|Settings/;

/**
 * Derive the code for an error response from its status + message.
 * Mirrors the dispatcher's old status picking (unknown → 404, bad
 * request text → 400, unwired → 501), so existing statuses are unchanged.
 */
export function errorCodeFor(status: number, message: string): ApiErrorCode | undefined {
  if (status === 404 || NOT_FOUND_TEXT.test(message)) return "not-found";
  if (NO_AGENT_TEXT.test(message)) return "no-agent";
  if (status === 501 || /not available in this build/.test(message)) return "not-implemented";
  if (status === 400 || INVALID_TEXT.test(message)) return "invalid-request";
  return undefined;
}

/** Send the app's usual error body with its code. */
export function sendError(
  reply: FastifyReply,
  status: number,
  message: string,
  code?: ApiErrorCode,
): unknown {
  const resolved = code ?? errorCodeFor(status, message);
  const body: ApiErrorBody = resolved === undefined ? { error: message } : { error: message, code: resolved };
  return reply.code(status).send(body);
}
