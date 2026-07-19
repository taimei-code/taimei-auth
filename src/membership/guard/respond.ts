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
