import { describe, expect, test } from "bun:test";
import { mergeSessionIndex } from "../session-index";

const NOW = 1_000_000;
const entry = (token: string, expiresInSeconds: number) => ({
  token,
  expiresAt: NOW + expiresInSeconds * 1000,
});
const tokensOf = (value: string) =>
  (JSON.parse(value) as { token: string; expiresAt: number }[]).map(({ token }) => token);

describe("利用者ごとの session の一覧を、同時に書いても項目が落ちないように合わせる", () => {
  test("better-auth が同じ一覧を読んで別々に足した 2 つの書き込みを合わせると、両方の session が残る", () => {
    const first = mergeSessionIndex(
      JSON.stringify([entry("s0", 60)]),
      JSON.stringify([entry("s0", 60), entry("s1", 120)]),
      NOW,
    );
    const second = mergeSessionIndex(
      first.value,
      JSON.stringify([entry("s0", 60), entry("s2", 90)]),
      NOW,
    );

    expect(tokensOf(second.value)).toEqual(["s0", "s2", "s1"]);
  });

  test("同じ token は書き込む側の期限にする", () => {
    const merged = mergeSessionIndex(
      JSON.stringify([entry("s0", 60)]),
      JSON.stringify([entry("s0", 300)]),
      NOW,
    );

    expect(JSON.parse(merged.value)).toEqual([entry("s0", 300)]);
  });

  test("保存済みにだけある項目は、期限内なら残し、期限が切れていれば残さない", () => {
    const merged = mergeSessionIndex(
      JSON.stringify([entry("expired", 0), entry("alive", 1)]),
      JSON.stringify([entry("s1", 60)]),
      NOW,
    );

    expect(tokensOf(merged.value)).toEqual(["alive", "s1"]);
  });

  test("読めない保存済みの値は、空の一覧として扱う", () => {
    const merged = mergeSessionIndex("not-json", JSON.stringify([entry("s1", 60)]), NOW);

    expect(tokensOf(merged.value)).toEqual(["s1"]);
  });

  test("一覧の有効期限は、合わせた後のいちばん遅い session の期限に合わせる", () => {
    const merged = mergeSessionIndex(
      JSON.stringify([entry("s0", 600)]),
      JSON.stringify([entry("s1", 60)]),
      NOW,
    );

    expect(merged.ttlSeconds).toBe(600);
  });
});
