import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { Hono } from "hono";
import { recordSentry } from "../../src/__tests__/sentry-recorder";
import { authHostOrigin, ORIGIN_REJECTED_LOG, requireAuthHostOrigin } from "../auth-host-origin";

const sentry = recordSentry();
const configuredAuthServiceUrl = process.env.AUTH_SERVICE_URL;

afterEach(() => {
  process.env.AUTH_SERVICE_URL = configuredAuthServiceUrl;
});

const postWith = (authServiceUrl: string, headers: HeadersInit) => {
  process.env.AUTH_SERVICE_URL = authServiceUrl;
  const app = new Hono();
  app.post("/x", requireAuthHostOrigin, (c) => c.text("handled"));
  return app.request("/x", { method: "POST", headers });
};

describe("AUTH_SERVICE_URL から http の origin を作れない時も、Origin の検査は POST を通さない", () => {
  test("scheme の無い AUTH_SERVICE_URL の origin は null なので、Origin: null の POST も 403", async () => {
    const response = await postWith("auth.example.local:3100", { origin: "null" });

    expect(response.status).toBe(403);
  });

  test("URL として読めない AUTH_SERVICE_URL では、POST を通さず 500 を返し、Sentry に記録する", async () => {
    sentry.reset();

    const response = await postWith("not a url", { origin: "null" });

    expect(response.status).toBe(500);
    expect(sentry.exceptions.length).toBe(1);
  });
});

describe("Origin の検査で拒んだ POST は、受け取った Origin と期待した Origin を warn の log に出す", () => {
  test("別の origin から送られた POST の log に、両方の origin が出る", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const expected = authHostOrigin();
      const response = await postWith(expected, { origin: "https://evil.example" });

      expect(response.status).toBe(403);
      expect(warn.mock.calls).toEqual([
        [
          ORIGIN_REJECTED_LOG,
          JSON.stringify({
            method: "POST",
            path: "/x",
            received: "https://evil.example",
            expected,
          }),
        ],
      ]);
    } finally {
      warn.mockRestore();
    }
  });
});
