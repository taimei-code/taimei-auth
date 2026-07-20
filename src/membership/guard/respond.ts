import type { Forbidden, InvalidArgument, NotFound, Unauthorized } from "./core";

// guard entry の failure を Hono 非依存の Response に写像する。route 側は
// `if (!r.ok) return guardErrorResponse(r)` の 1 行で済む。Web 標準 `Response.json()` は
// `application/json` (charset なし) を返す — 現行の Hono `c.json()` も同一のため明示 header で
// application/json を維持し byte-invariant に保つ (成功 response は route 側で c.json のままとし
// success/error 間で Content-Type を揃える)。
// エラー文字列と HTTP status の対応表は本 file に集約する — route から散らばると同じ文字列を
// 別 status で返す silent なずれ (SPA が error 分岐を hard-code する場合の破損) が発生するため。

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

// use-case が Result で返す reason literal を GuardErrorResult (status 込み) に写像する。
// 全 use-case の reason literal を GuardReason union に集約し、写像 table を Record 型で pin する
// ことで、未登録 reason があれば typecheck が落ちる = silent 500 化を type gate で予防する。
// 緩い `Record<string, GuardErrorResult>` にしないのは、未登録 reason が undefined を返して
// 500 に silent 化する事故を型で防ぐため (ADR-0012)。
export type GuardReason =
  | "forbidden"
  | "not_found"
  | "last_owner"
  | "already_exists"
  | "not_found_or_not_pending"
  | "rate_limited"
  | "expired_or_used";

const REASON_TO_ERROR: Record<GuardReason, GuardErrorResult> = {
  forbidden: { ok: false, error: "forbidden", status: 403 },
  not_found: { ok: false, error: "not_found", status: 404 },
  last_owner: { ok: false, error: "last_owner", status: 409 },
  already_exists: { ok: false, error: "already_exists", status: 409 },
  not_found_or_not_pending: { ok: false, error: "not_found_or_not_pending", status: 404 },
  rate_limited: { ok: false, error: "rate_limited", status: 429 },
  expired_or_used: { ok: false, error: "expired_or_used", status: 410 },
};

export function reasonToGuardError(reason: GuardReason): GuardErrorResult {
  return REASON_TO_ERROR[reason];
}

const JSON_HEADERS = { "content-type": "application/json" } as const;

export function guardErrorResponse(result: GuardErrorResult): Response {
  const body: { error: string; details?: unknown } = { error: result.error };
  // details は InvalidArgument variant にのみ存在するため、in narrowing で access する
  // (union で narrow できないと成功枝 body key の順序が silent に崩れる)。
  if ("details" in result && result.details !== undefined) {
    body.details = result.details;
  }
  return new Response(JSON.stringify(body), {
    status: result.status,
    headers: JSON_HEADERS,
  });
}
