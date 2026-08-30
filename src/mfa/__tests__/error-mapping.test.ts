import { describe, expect, test } from "bun:test";
import {
  ALREADY_ENABLED,
  CHALLENGE_EXPIRED,
  ENROLLMENT_CHANGED,
  failure,
  INVALID_CODE,
  LOCKED,
  NOT_ENABLED,
  NOT_FOUND,
} from "../error-mapping";

// プラグイン写像は消滅 (完全自前化: ADR-0016)。残るのは定数群と Result 化 helper のみ。
// wire 語彙との双方向一致は error-mapping.ts 内の MatchesWireShape 検出器 (typecheck) が固定する。

describe("MFA エラー定数", () => {
  test("QA-M-11 各定数の error / status の対", () => {
    expect(INVALID_CODE).toEqual({ error: "invalid_code", status: 400 });
    expect(LOCKED).toEqual({ error: "locked", status: 429 });
    expect(CHALLENGE_EXPIRED).toEqual({ error: "challenge_expired", status: 401 });
    expect(ALREADY_ENABLED).toEqual({ error: "already_enabled", status: 409 });
    expect(ENROLLMENT_CHANGED).toEqual({ error: "enrollment_changed", status: 409 });
    expect(NOT_ENABLED).toEqual({ error: "not_enabled", status: 409 });
    expect(NOT_FOUND).toEqual({ error: "not_found", status: 404 });
  });

  test("QA-M-11 failure() は handler が 1 行で HTTP に落とせる形を返す", () => {
    expect(failure(INVALID_CODE)).toEqual({ ok: false, error: "invalid_code", status: 400 });
  });
});
