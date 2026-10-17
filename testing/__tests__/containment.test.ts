import { describe, expect, test } from "bun:test";
import { grepFiles } from "../../src/__tests__/source-scan";

describe("資格情報なしに user を作る経路は試験の use-case に閉じる", () => {
  test("AuthApi.createUser を呼ぶのは、試験の利用者を作る use-case だけ", () => {
    const callers = ["src", "testing"].flatMap((root) =>
      grepFiles("(^|[^A-Za-z0-9_$])createUser\\(", root, { tests: "exclude" }),
    );
    expect(callers.sort()).toEqual([
      "src/auth-service.ts",
      "src/auth-wiring.ts",
      "testing/create-signed-in-user.ts",
    ]);
  });
});
