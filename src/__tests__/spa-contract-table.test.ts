import { describe, expect, test } from "bun:test";
import { declaredFailure, endpointPattern } from "../../e2e/contract-mock";
import { spaEndpointTable } from "../spa-contract-table";

const BASE = "http://localhost:3110";

describe("SPA の API 契約から、endpoint の path と宣言した失敗の status を引く", () => {
  test("契約の 22 の endpoint を引き、verify の ChallengeExpired は 401 である", () => {
    const table = spaEndpointTable();
    expect(table).toHaveLength(22);
    const verify = table.find((endpoint) => endpoint.name === "mfaChallenge.verify");
    expect(verify?.failures.get("ChallengeExpired")).toBe(401);
  });

  test("endpoint の path から作る pattern は、その path に一致し、下に続く別の path に一致しない", () => {
    const state = endpointPattern("mfaChallenge.state");
    expect(state.test(`${BASE}/api/mfa/challenge`)).toBe(true);
    expect(state.test(`${BASE}/api/mfa/challenge/verify`)).toBe(false);
    expect(
      endpointPattern("membership.list").test(`${BASE}/api/account/companies/co_1/members`),
    ).toBe(true);
  });

  test("parameter を持つ path の pattern は、同じ位置が固定の文字列の別の endpoint の path に一致しない", () => {
    const update = endpointPattern("company.update");
    expect(update.test(`${BASE}/api/account/companies/co_1`)).toBe(true);
    expect(update.test(`${BASE}/api/account/companies/add`)).toBe(false);
  });

  test("宣言した失敗のモックは status と _tag を契約から作り、契約に無い endpoint や _tag では throw する", () => {
    expect(declaredFailure("mfaChallenge.verify", "ChallengeExpired")).toEqual({
      status: 401,
      json: { _tag: "ChallengeExpired" },
    });
    expect(() => declaredFailure("nope.nope", "Forbidden")).toThrow();
    expect(() => declaredFailure("mfaChallenge.verify", "Forbidden")).toThrow();
  });
});
