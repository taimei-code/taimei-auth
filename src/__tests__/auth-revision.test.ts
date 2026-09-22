import { describe, expect, test } from "bun:test";
import { auth } from "../auth";

describe("better-auth getSession exposes user.revision", () => {
  // ここでは型だけを検証する (実行時の挙動は db/__tests__/user-revision.test.ts と手動 QA で確認する)。
  test("Session type infers revision: number", () => {
    type SessionUser = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>["user"];
    type HasRevision = SessionUser extends { revision: number } ? true : false;
    const ok: HasRevision = true;
    expect(ok).toBe(true);
  });
});
