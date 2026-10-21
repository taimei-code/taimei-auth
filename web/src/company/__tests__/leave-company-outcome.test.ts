import { describe, expect, test } from "bun:test";
import { Cause } from "effect";

import { Forbidden, NotFound } from "@core/failures";
import { LastOwner } from "@core/membership/errors";

import { leaveCompanyOutcome } from "../leave-company-outcome";

const FAILED = { kind: "failed", message: "事業所から抜けられませんでした。" } as const;

describe("事業所から抜ける操作の失敗を、画面の結果に写す", () => {
  test("唯一の OWNER で抜けられない時は、OWNER の委譲の案内を出す", () => {
    expect(leaveCompanyOutcome(Cause.fail(new LastOwner()))).toEqual({ kind: "soleOwner" });
  });

  test("Forbidden・NotFound・通信の失敗は、抜けられなかった文言を出す", () => {
    expect(leaveCompanyOutcome(Cause.fail(new Forbidden()))).toEqual(FAILED);
    expect(leaveCompanyOutcome(Cause.fail(new NotFound()))).toEqual(FAILED);
    expect(leaveCompanyOutcome(Cause.die(new Error("network")))).toEqual(FAILED);
  });
});
