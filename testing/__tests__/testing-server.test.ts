import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../../src/app";

const TESTING_ENTRY = join(import.meta.dir, "../server.ts");

const unusedPort = () => {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const { port } = probe;
  probe.stop(true);
  if (port === undefined) throw new Error("Bun.serve did not bind a TCP port");
  return port;
};

const testingServerEnv = (appEnv: string | undefined, port: number) => {
  const env = { ...process.env, APP_ENV: appEnv, PORT: String(port) };
  if (appEnv === undefined) delete env.APP_ENV;
  return env;
};

const testingServerCommand = [process.execPath, TESTING_ENTRY];

const waitForResponse = async (
  url: string,
  child: Bun.Subprocess<"ignore", "pipe", "pipe">,
): Promise<Response> => {
  while (child.exitCode === null) {
    const response = await fetch(url).catch(() => null);
    if (response) return response;
    await Bun.sleep(100);
  }
  throw new Error(`exit ${child.exitCode}: ${await new Response(child.stderr).text()}`);
};

describe("試験用の entry は APP_ENV=test の時だけ起動する", () => {
  test.each([
    ["APP_ENV が未設定", undefined],
    ["APP_ENV=production", "production"],
    ["APP_ENV が誤記", "prodution"],
  ])("%s なら、boot の前に APP_ENV=test を求めて 0 以外で終わる", (_, appEnv) => {
    const result = Bun.spawnSync(testingServerCommand, {
      cwd: tmpdir(),
      env: testingServerEnv(appEnv, unusedPort()),
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toBe(
      "FATAL: testing/server.ts starts only with APP_ENV=test.\n",
    );
    expect(result.stdout.toString()).toBe("");
  });

  test("APP_ENV=test なら起動し、better-auth の疎通確認に 200 を返す", async () => {
    const port = unusedPort();
    const child = Bun.spawn(testingServerCommand, {
      cwd: tmpdir(),
      env: testingServerEnv("test", port),
      stdout: "pipe",
      stderr: "pipe",
    });
    try {
      const response = await waitForResponse(`http://localhost:${port}/api/auth/ok`, child);
      expect(response.status).toBe(200);
    } finally {
      child.kill();
      await child.exited;
    }
  }, 15_000);
});

describe("本番の worker と同じ app", () => {
  test("APP_ENV が未設定・production・誤記・test のどれでも、試験用の route (POST /testing/v1/*) が無い", async () => {
    const previous = process.env.APP_ENV;
    const statuses: Record<string, number> = {};
    try {
      for (const value of [undefined, "production", "prodution", "test"]) {
        if (value === undefined) delete process.env.APP_ENV;
        else process.env.APP_ENV = value;
        const response = await buildApp({ mountStatic: () => {} }).request(
          "/testing/v1/signed-in-users",
          { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
        );
        statuses[value ?? "(unset)"] = response.status;
      }
    } finally {
      if (previous === undefined) delete process.env.APP_ENV;
      else process.env.APP_ENV = previous;
    }

    expect(statuses).toEqual({ "(unset)": 404, production: 404, prodution: 404, test: 404 });
  });
});
