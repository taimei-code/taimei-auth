import { describe, expect, test } from "bun:test";
import { auth } from "../auth";

describe("better-auth getSession exposes user.revision", () => {
  // 型のみ検証 (runtime は db/__tests__/user-revision.test.ts + 手動 QA でカバー)。
  test("Session type infers revision: number", () => {
    type SessionUser = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>["user"];
    type HasRevision = SessionUser extends { revision: number } ? true : false;
    const ok: HasRevision = true;
    expect(ok).toBe(true);
  });
});
