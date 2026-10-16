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

  test("本番の worker と同じ app には、APP_ENV がどの値でも試験 API の route が無い", async () => {
    const app = buildApp({ mountStatic: () => {} });
    const response = await app.request("/testing/v1/signed-in-users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(404);
  });
});
