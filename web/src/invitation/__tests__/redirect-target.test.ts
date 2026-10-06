import { describe, expect, test } from "bun:test";

import { redirectUrlAfterAccept, parseRedirectTarget } from "../redirect-target";

const REDIRECT_URL = "https://app.taimei-code.com/dashboard";
const search = (params: Record<string, string>) =>
  new URLSearchParams({ invitation_token: "tok", ...params });

const valid = search({ service_name: "taimei", redirect_url: REDIRECT_URL });
const invalidCases = [
  ["組が無い", search({})],
  ["allowlist 外", search({ service_name: "taimei", redirect_url: "https://evil.example.com/" })],
  ["service_name だけ", search({ service_name: "taimei" })],
  ["redirect_url だけ", search({ redirect_url: REDIRECT_URL })],
] as const;

describe("redirectUrlAfterAccept", () => {
  test("AC-004 有効な組なら redirect_url", () => {
    expect(redirectUrlAfterAccept(valid)).toBe(REDIRECT_URL);
  });

  test.each(invalidCases)("AC-005〜007 %s なら /account", (_, params) => {
    expect(redirectUrlAfterAccept(params)).toBe("/account");
  });
});

describe("parseRedirectTarget", () => {
  test("AC-035 有効な組を返す", () => {
    expect(parseRedirectTarget(valid)).toEqual({
      service_name: "taimei",
      redirect_url: REDIRECT_URL,
    });
  });

  test.each(invalidCases)("AC-035 %s なら undefined", (_, params) => {
    expect(parseRedirectTarget(params)).toBeUndefined();
  });
});
