import { afterAll, beforeAll, expect, test } from "bun:test";
import { buildApp } from "../../app";

const ENV = { APP_ENV: "production", AUTH_TRUSTED_PROXY_HOPS: "1" };
const previous = Object.entries(ENV).map(([key]) => [key, process.env[key]] as const);
beforeAll(() => {
  Object.assign(process.env, ENV);
});
afterAll(() => {
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("Hono の IP 単位の rate limit は、HttpApi に載せた MFA チャレンジの verify にも先に掛かる", async () => {
  const app = buildApp({ mountStatic: () => {} });
  const clientIp = `2001:db8::${crypto.randomUUID().slice(0, 4)}:${crypto.randomUUID().slice(0, 4)}`;
  const statuses: number[] = [];
  for (let i = 0; i < 11; i++) {
    const res = await app.request("/api/mfa/challenge/verify", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": clientIp },
      body: JSON.stringify({ code: "000000", kind: "totp" }),
    });
    statuses.push(res.status);
  }
  expect(statuses.slice(0, 10).every((s) => s !== 429)).toBe(true);
  expect(statuses[10]).toBe(429);
});
