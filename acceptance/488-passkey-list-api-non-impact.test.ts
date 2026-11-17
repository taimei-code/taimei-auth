import { afterEach, expect, test } from "bun:test";
import {
  createUser,
  forgetSessionCounts,
  openSession,
  readPasskeys,
  removeCreatedUsers,
  startMfaEnrollment,
} from "./harness/passkey-list-api";

afterEach(async () => {
  forgetSessionCounts();
  await removeCreatedUsers();
});

test("同じ session で一覧を 10 回読んだ後も、MFA の有効化の開始は試行枠の失敗にならない", async () => {
  const owner = await createUser("owner");
  const session = await openSession(owner);
  for (let i = 0; i < 10; i++) await readPasskeys(session);

  const enrollment = await startMfaEnrollment(session);

  expect(enrollment.status).not.toBe(429);
  expect(enrollment.status).toBeLessThan(500);
});
