import { describe, expect, test } from "bun:test";
import { Cause } from "effect";

import { LastOwner } from "@core/membership/errors";
import { Unauthorized } from "@core/membership/guard/errors";

import { failureMessage, hasFailureTag } from "../failure-message";

const MESSAGES = { LastOwner: "最後のオーナーです" };

describe("failureMessage", () => {
  test("宣言した失敗は、表のその _tag の文言を返す", () => {
    const cause: Cause.Cause<LastOwner | Unauthorized> = Cause.fail(new LastOwner());

    expect(failureMessage(cause, MESSAGES, "失敗しました")).toBe("最後のオーナーです");
  });

  test("型付きの失敗を持たない cause (通信と decode の失敗) は既定の文言を返す", () => {
    const cause: Cause.Cause<LastOwner | Unauthorized> = Cause.die(new Error("network"));

    expect(failureMessage(cause, MESSAGES, "失敗しました")).toBe("失敗しました");
  });

  test("宣言した失敗の _tag を表から欠くと型エラーになる", () => {
    const cause: Cause.Cause<LastOwner | Unauthorized> = Cause.fail(new LastOwner());

    // @ts-expect-error LastOwner の文言が無い
    const message = failureMessage(cause, {}, "失敗しました");

    expect(message).toBe("失敗しました");
  });

  test("Unauthorized は表に書かず、受けた時は既定の文言を返す (SPA の API の client がログイン画面へ移すため)", () => {
    const cause: Cause.Cause<LastOwner | Unauthorized> = Cause.fail(new Unauthorized());

    expect(failureMessage(cause, MESSAGES, "失敗しました")).toBe("失敗しました");
  });
});

describe("hasFailureTag", () => {
  test("宣言した失敗の _tag が一致する時だけ true", () => {
    const cause: Cause.Cause<LastOwner | Unauthorized> = Cause.fail(new LastOwner());

    expect(hasFailureTag(cause, "LastOwner")).toBe(true);
    expect(hasFailureTag(cause, "Unauthorized")).toBe(false);
    const defect: Cause.Cause<LastOwner | Unauthorized> = Cause.die(new Error("network"));
    expect(hasFailureTag(defect, "LastOwner")).toBe(false);
  });

  test("宣言していない _tag を渡すと型エラーになる", () => {
    const cause: Cause.Cause<LastOwner | Unauthorized> = Cause.fail(new LastOwner());

    // @ts-expect-error AlreadyExists はこの cause の失敗に無い
    expect(hasFailureTag(cause, "AlreadyExists")).toBe(false);
  });
});
