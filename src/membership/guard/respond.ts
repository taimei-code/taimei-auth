import type { Forbidden, InvalidArgument, NotFound, Unauthorized } from "./core";

// guard entry の failure を Hono 非依存の Response に写像する (ADR-0012)。明示 header で application/json
// を維持し成功 response と byte-invariant に保つ。文字列 × status の対応表は本 file に集約する。

export type GuardErrorResult =
  | Unauthorized
  | Forbidden
  | NotFound
  | InvalidArgument
  | { ok: false; error: "email_mismatch"; status: 403 }
  | { ok: false; error: "not_found_or_not_pending"; status: 404 }
  | { ok: false; error: "not_found_or_already_deleted"; status: 404 }
  | { ok: false; error: "expired_or_used"; status: 410 }
  | { ok: false; error: "already_owner"; status: 400 }
  | { ok: false; error: "already_exists"; status: 409 }
  | { ok: false; error: "last_owner"; status: 409 }
  | { ok: false; error: "rate_limited"; status: 429 };

// use-case の reason literal を GuardErrorResult に写像する。Record 型で pin するのは、未登録 reason が
// undefined を返して silent に 500 化する事故を typecheck で落とすため (ADR-0012)。
export type GuardReason =
  | "forbidden"
  | "not_found"
  | "last_owner"
  | "already_exists"
  | "not_found_or_not_pending"
  | "not_found_or_already_deleted"
  | "rate_limited"
  | "expired_or_used";

const REASON_TO_ERROR: Record<GuardReason, GuardErrorResult> = {
  forbidden: { ok: false, error: "forbidden", status: 403 },
  not_found: { ok: false, error: "not_found", status: 404 },
  last_owner: { ok: false, error: "last_owner", status: 409 },
  already_exists: { ok: false, error: "already_exists", status: 409 },
  not_found_or_not_pending: { ok: false, error: "not_found_or_not_pending", status: 404 },
  not_found_or_already_deleted: {
    ok: false,
    error: "not_found_or_already_deleted",
    status: 404,
  },
  rate_limited: { ok: false, error: "rate_limited", status: 429 },
  expired_or_used: { ok: false, error: "expired_or_used", status: 410 },
};

export function reasonToGuardError(reason: GuardReason): GuardErrorResult {
  return REASON_TO_ERROR[reason];
}

const JSON_HEADERS = { "content-type": "application/json" } as const;

export function guardErrorResponse(result: GuardErrorResult): Response {
  const body: { error: string; details?: unknown } = { error: result.error };
  // details は InvalidArgument variant にのみ存在するため in narrowing で access する。
  if ("details" in result && result.details !== undefined) {
    body.details = result.details;
  }
  return new Response(JSON.stringify(body), {
    status: result.status,
    headers: JSON_HEADERS,
  });
}
