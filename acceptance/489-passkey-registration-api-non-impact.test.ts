import { afterEach, expect, test } from "bun:test";
import {
  createUser,
  forgetScenario,
  openSession,
  requestOptions,
  startMfaEnrollment,
} from "./harness/passkey-registration-api";

afterEach(async () => {
  await forgetScenario();
});

test("同じ session で options を 10 回取った後も、MFA の有効化の開始は試行枠の失敗にならない", async () => {
  const owner = await createUser("owner");
  const session = openSession(owner);
  for (let i = 0; i < 10; i++) await requestOptions(session);

  const enrollment = await startMfaEnrollment(session);

  expect(enrollment.status).not.toBe(429);
  expect(enrollment.status).toBeLessThan(500);
});
