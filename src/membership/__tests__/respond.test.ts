import { describe, expect, test } from "bun:test";
import {
  type GuardErrorResult,
  type GuardReason,
  guardErrorResponse,
  reasonToGuardError,
} from "../guard";

// guardErrorResponse は Web 標準 Response で組む。Hono `c.json` と Content-Type を合わせ
// (application/json, charset なし) migrated route の byte-invariant を守る。
// error 文字列 × status の catalog は本 test で snapshot 化する — 新規 error を足すと
// catalog 表と対照させないと SPA / consumer 側の error 分岐が silent に破損するため。

describe("guardErrorResponse", () => {
  test("body key 順序 — error のみ (details 無し) は { error } のみ", async () => {
    const res = guardErrorResponse({
      ok: false,
      error: "forbidden",
      status: 403,
    });
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toBe("application/json");
    const text = await res.text();
    expect(text).toBe('{"error":"forbidden"}');
  });

  test("body key 順序 — details 付きは error, details の順 (SPA 分岐互換)", async () => {
    const res = guardErrorResponse({
      ok: false,
      error: "invalid_argument",
      status: 400,
      details: { fieldErrors: { email: ["invalid"] } },
    });
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toBe(
      '{"error":"invalid_argument","details":{"fieldErrors":{"email":["invalid"]}}}',
    );
  });

  test("Content-Type は application/json (Hono c.json と一致)", async () => {
    // Hono c.json も `application/json` (charset なし) を返すため、error/success 間で
    // Content-Type が silent に食い違わないよう明示 header で揃える。
    const res = guardErrorResponse({ ok: false, error: "unauthorized", status: 401 });
    expect(res.headers.get("content-type")).toBe("application/json");
  });

  // error 文字列 × status の 1-to-1 catalog snapshot。同一 status に複数 error 文字列が
  // 割り当てられているものは全て列挙する (silent rename の検知)。GuardErrorResult union の
  // 各 variant を tuple で列挙し、TS の narrow が効くよう satisfies で型を pin する。
  test("error 文字列 × status の catalog snapshot", async () => {
    const catalog = [
      { ok: false, error: "unauthorized", status: 401 },
      { ok: false, error: "invalid_argument", status: 400 },
      { ok: false, error: "already_owner", status: 400 },
      { ok: false, error: "forbidden", status: 403 },
      { ok: false, error: "email_mismatch", status: 403 },
      { ok: false, error: "not_found", status: 404 },
      { ok: false, error: "not_found_or_not_pending", status: 404 },
      { ok: false, error: "not_found_or_already_deleted", status: 404 },
      { ok: false, error: "last_owner", status: 409 },
      { ok: false, error: "already_exists", status: 409 },
      { ok: false, error: "expired_or_used", status: 410 },
      { ok: false, error: "rate_limited", status: 429 },
    ] satisfies GuardErrorResult[];
    for (const entry of catalog) {
      const res = guardErrorResponse(entry);
      expect(res.status).toBe(entry.status);
      const body = await res.json();
      expect(body).toEqual({ error: entry.error });
    }
  });

  // QA-H-06 / QA-E-07: reasonToGuardError の 7 literal 網羅性を type gate + runtime で保証する。
  // Record<GuardReason, GuardErrorResult> の compile 網羅性は typecheck が担い、literal ↔ status
  // の対応表を runtime でも pin することで、Record 誤更新 (typo / 誤 key) の regression を検知する。
  test("QA-H-06 / QA-E-07 reasonToGuardError は全 GuardReason literal を対応 GuardErrorResult に写像する", () => {
    const cases = [
      { reason: "forbidden", error: "forbidden", status: 403 },
      { reason: "not_found", error: "not_found", status: 404 },
      { reason: "last_owner", error: "last_owner", status: 409 },
      { reason: "already_exists", error: "already_exists", status: 409 },
      { reason: "not_found_or_not_pending", error: "not_found_or_not_pending", status: 404 },
      { reason: "rate_limited", error: "rate_limited", status: 429 },
      { reason: "expired_or_used", error: "expired_or_used", status: 410 },
    ] as const satisfies ReadonlyArray<{
      reason: GuardReason;
      error: GuardErrorResult["error"];
      status: GuardErrorResult["status"];
    }>;
    for (const { reason, error, status } of cases) {
      const mapped = reasonToGuardError(reason);
      expect(mapped.ok).toBe(false);
      expect(mapped.error).toBe(error);
      expect(mapped.status).toBe(status);
    }
    // 網羅性: cases は上記 7 literal を 1:1 で列挙する。GuardReason に新 literal を足したら
    // ここも足すこと (typecheck が cases の Array<{reason: GuardReason,...}> を強制し、
    // Record 側の網羅性欠落と対で fail-closed する)。
    expect(cases.length).toBe(7);
  });
});
