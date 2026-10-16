import { describe, expect, test } from "bun:test";
import { buildApp } from "../../app";
import { REPO_ROOT } from "../../__tests__/source-scan";

describe("試験用の entry と本番", () => {
  test("試験用の entry は APP_ENV=production では起動を拒み、0 以外で終わる", async () => {
    const child = Bun.spawn(["bun", "run", "src/testing-server.ts"], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        APP_ENV: "production",
        AUTH_SERVICE_KEY: "production-key",
        AUTH_TRUSTED_PROXY_HOPS: "0",
        PORT: "0",
      },
      stderr: "pipe",
      stdout: "pipe",
    });
    const exitCode = await child.exited;
    expect(exitCode).not.toBe(0);
    expect(await new Response(child.stderr).text()).toContain(
      "testing-server refuses to start with APP_ENV=production",
    );
  });

  test("本番の worker と同じ app には、APP_ENV が未設定・production・誤記・test のどれでも試験 API の route が無い", async () => {
    const previous = process.env.APP_ENV;
    const statuses: Record<string, number> = {};
    try {
      for (const value of [undefined, "production", "prodution", "test"]) {
        if (value === undefined) delete process.env.APP_ENV;
        else process.env.APP_ENV = value;
        const app = buildApp({ mountStatic: () => {} });
        const response = await app.request("/testing/v1/signed-in-users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        statuses[value ?? "(unset)"] = response.status;
      }
    } finally {
      if (previous === undefined) delete process.env.APP_ENV;
      else process.env.APP_ENV = previous;
    }
    expect(statuses).toEqual({ "(unset)": 404, production: 404, prodution: 404, test: 404 });
  });
});
