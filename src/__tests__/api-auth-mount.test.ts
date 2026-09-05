import { describe, expect, spyOn, test } from "bun:test";
import { buildApp } from "../app";
import { auth } from "../auth";
import { recordSentryExceptions } from "./sentry-recorder";

// src/app.ts の /api/auth/* mount: better-auth の router は onRequest 段 (rate limiter の Redis 読み) の throw を
// onError に渡さず auth.handler の reject にする (better-auth-on-api-error.test.ts の機構の固定)。Hono 既定の
// errorHandler は Sentry に届かないので、mount が拾って captureThrown に送り 500 を返す。
describe("/api/auth/* の mount は auth.handler の reject を Sentry に送る", () => {
  const captured = recordSentryExceptions();
  const app = buildApp({ mountStatic: () => {} });

  test("reject は component=better-auth で error として送り、Hono 既定と同じ 500 text を返す", async () => {
    const rejection = new Error("upstash down");
    const handler = spyOn(auth, "handler").mockRejectedValue(rejection);
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    try {
      const n = captured.length;
      const res = await app.request("http://localhost/api/auth/get-session");
      expect(res.status).toBe(500);
      expect(await res.text()).toBe("Internal Server Error");
      expect(captured.length - n).toBe(1);
      expect(captured[n]?.[0]).toBe(rejection);
      expect(captured[n]?.[1]).toEqual({ level: "error", tags: { component: "better-auth" } });
      expect(consoleError).toHaveBeenCalledTimes(1);
    } finally {
      handler.mockRestore();
      consoleError.mockRestore();
    }
  });

  test("POST も同じ経路で拾い、body を再構築した Request を渡す", async () => {
    const handler = spyOn(auth, "handler").mockRejectedValue(new Error("upstash down"));
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    try {
      const n = captured.length;
      const res = await app.request("http://localhost/api/auth/sign-in/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "a@example.com" }),
      });
      expect(res.status).toBe(500);
      expect(captured.length - n).toBe(1);
      const passed = handler.mock.calls[0]?.[0] as Request;
      expect(passed.method).toBe("POST");
      expect(await passed.text()).toBe(JSON.stringify({ email: "a@example.com" }));
    } finally {
      handler.mockRestore();
      consoleError.mockRestore();
    }
  });

  test("resolve した Response はそのまま返し、Sentry には送らない", async () => {
    const handler = spyOn(auth, "handler").mockResolvedValue(new Response("ok", { status: 200 }));
    try {
      const n = captured.length;
      const res = await app.request("http://localhost/api/auth/ok");
      expect(res.status).toBe(200);
      expect(captured.length - n).toBe(0);
    } finally {
      handler.mockRestore();
    }
  });
});
