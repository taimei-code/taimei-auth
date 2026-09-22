import { describe, expect, test } from "bun:test";
import { resolveCrossSubDomainCookies } from "../cookie-domain";

// AUTH_TRUSTED_ORIGINS の誤設定や cross-subdomain で Cookie が共有されない不具合は、実際のブラウザでしか
// 症状が出ない種類のバグである。ただし判定自体は env の値から boolean と domain を導く純ロジックなので、
// ここで固定する (ADR-0004 の決定表)。

describe("resolveCrossSubDomainCookies", () => {
  test.each([
    ["未指定 (undefined)", undefined, { enabled: false, domain: "taimei-code.com" }],
    ["空文字", "", { enabled: false, domain: "taimei-code.com" }],
    [
      "localhost (明示設定でも disable の double-guard)",
      "localhost",
      { enabled: false, domain: "localhost" },
    ],
    [
      "taimei-code.local (local の cross-subdomain)",
      "taimei-code.local",
      { enabled: true, domain: "taimei-code.local" },
    ],
    [
      "taimei-code.com (production)",
      "taimei-code.com",
      { enabled: true, domain: "taimei-code.com" },
    ],
  ])("AUTH_COOKIE_DOMAIN=%s → %j", (_name, input, expected) => {
    expect(resolveCrossSubDomainCookies(input)).toEqual(expected);
  });
});
