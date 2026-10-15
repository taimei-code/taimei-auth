import { describe, expect, test } from "bun:test";

import { signOut } from "../sign-out";

describe("signOut", () => {
  test("better-auth が error を返さなければ signedOut を返す", async () => {
    expect(await signOut(async () => ({ error: null }))).toBe("signedOut");
  });

  test("better-auth が error を返すと failed を返す (client は失敗を throw せず error で返す)", async () => {
    expect(await signOut(async () => ({ error: { status: 500 } }))).toBe("failed");
  });

  test("通信が reject すると failed を返す", async () => {
    expect(
      await signOut(async () => {
        throw new Error("network");
      }),
    ).toBe("failed");
  });
});
