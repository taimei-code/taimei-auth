import { describe, expect, test } from "bun:test";
import { grepLines } from "../../__tests__/source-scan";
import { isMfaEnabled } from "../policy";

describe("isMfaEnabled (MFA 登録状態が「有効」かの判定)", () => {
  test("行なし (未登録) は有効でない", () => {
    expect(isMfaEnabled(undefined)).toBe(false);
  });

  test("verifiedAt NULL (登録済み未有効) は有効でない", () => {
    expect(isMfaEnabled({ verifiedAt: null })).toBe(false);
  });

  test("verifiedAt 非 NULL (有効) のみ有効", () => {
    expect(isMfaEnabled({ verifiedAt: new Date("2026-01-01T00:00:00Z") })).toBe(true);
  });

  test("true 側で row の型が { verifiedAt: Date } に狭まる (boolean に戻すと次の行が typecheck で落ちる)", () => {
    const row: { verifiedAt: Date | null } | undefined = { verifiedAt: new Date(0) };
    const at: Date | undefined = isMfaEnabled(row) ? row.verifiedAt : undefined;
    expect(at).toEqual(new Date(0));
  });

  test("述語は import 0 件 — verified_at を直接比較する第 2 の判定経路が生えない", () => {
    expect(grepLines("^import ", "src/mfa/policy.ts", {})).toEqual([]);

    const decidedSynchronously: boolean = isMfaEnabled({ verifiedAt: new Date() });
    expect(decidedSynchronously).toBe(true);
  });
});
