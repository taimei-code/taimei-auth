import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type SignedInUser, TESTING_PATH } from "@taimei-code/auth-client/testing";
import { deleteCompaniesByNames, deleteUsersByIds } from "../../db/testing/cleanup";
import { DEV_ACCOUNTS } from "../../db/testing/dev-accounts";
import { readUserIdsByEmails } from "../../db/testing/read";
import { buildApp } from "../../src/app";
import { getTrustedOrigins } from "../../src/env";
import { DEV_HOME_SIGN_IN_PATH, DEV_HOME_SIGN_OUT_PATH } from "../dev-home";

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

const SIGN_IN_QUERY = `?${new URLSearchParams({ service_name: "accounts", redirect_url: "http://localhost:3100/account" })}`;
const SIGN_IN_PATH = `/auth/${SIGN_IN_QUERY}`;
const devEmails = DEV_ACCOUNTS.users.map((devUser) => devUser.email);

const sessionTokenCookieWithoutCookieCache = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0] ?? "")
    .filter((cookie) => cookie.includes("session_token="))
    .join("; ");

const removeDevAccounts = async () => {
  await deleteUsersByIds(DEV_ACCOUNTS.users.map((devUser) => devUser.id));
  await deleteCompaniesByNames(DEV_ACCOUNTS.companies.map((devCompany) => devCompany.name));
};

const withTestingServer = async <A>(run: (baseUrl: string) => Promise<A>): Promise<A> => {
  const port = unusedPort();
  const child = Bun.spawn(testingServerCommand, {
    cwd: tmpdir(),
    env: testingServerEnv("test", port),
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    await waitForResponse(`http://localhost:${port}/api/auth/ok`, child);
    return await run(`http://localhost:${port}`);
  } finally {
    child.kill();
    await child.exited;
  }
};

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
    const status = await withTestingServer(
      async (baseUrl) => (await fetch(`${baseUrl}/api/auth/ok`)).status,
    );

    expect(status).toBe(200);
  }, 15_000);

  test("APP_ENV=test なら試験 API を載せ、試験の利用者を作るとログイン URL を返す", async () => {
    const response = await withTestingServer((baseUrl) =>
      fetch(`${baseUrl}${TESTING_PATH}/signed-in-users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companies: [], returnTo: `${getTrustedOrigins()[0]}/` }),
      }),
    );

    expect(response.status).toBe(200);
    const { loginUrl } = (await response.json()) as SignedInUser;
    expect(loginUrl).toStartWith(
      `${process.env.AUTH_SERVICE_URL}/api/auth/magic-link/verify?token=`,
    );
  }, 15_000);
});

describe("試験用の entry は、起動の前に開発用アカウントをそろえ、共通ログイン画面でアカウントを選ばせる", () => {
  test("共通ログイン画面の URL は、SPA より先に、開発用アカウントの一覧を返す", async () => {
    const body = await withTestingServer(async (baseUrl) =>
      (await fetch(`${baseUrl}${SIGN_IN_PATH}`)).text(),
    );

    for (const email of devEmails) expect(body).toContain(email);
  }, 15_000);

  test("選んだアカウントの session は、entry を起動し直しても TTL store に残る (session の cookie cache を送らずに確かめる)", async () => {
    const [owner] = DEV_ACCOUNTS.users;
    if (!owner) throw new Error("DEV_ACCOUNTS has no owner");

    const sessionCookie = await withTestingServer(async (baseUrl) => {
      const picked = await fetch(`${baseUrl}${TESTING_PATH}/account-picker${SIGN_IN_QUERY}`, {
        method: "POST",
        body: new URLSearchParams({ userId: owner.id }),
        redirect: "manual",
      });
      const magicLink = new URL(picked.headers.get("location") ?? "");
      const opened = await fetch(`${baseUrl}${magicLink.pathname}${magicLink.search}`, {
        redirect: "manual",
      });
      return sessionTokenCookieWithoutCookieCache(opened);
    });

    const session = await withTestingServer(async (baseUrl) =>
      (
        await fetch(`${baseUrl}/api/auth/get-session`, { headers: { cookie: sessionCookie } })
      ).json(),
    );

    expect(sessionCookie).toContain("session_token=");
    expect(session).toMatchObject({ user: { id: owner.id } });
  }, 30_000);

  test("同じ DB で 2 回続けて起動しても、2 回とも起動し、開発用アカウントは重複しない", async () => {
    await removeDevAccounts();

    const statuses = [
      await withTestingServer(async (baseUrl) => (await fetch(`${baseUrl}/api/auth/ok`)).status),
      await withTestingServer(async (baseUrl) => (await fetch(`${baseUrl}/api/auth/ok`)).status),
    ];

    expect(statuses).toEqual([200, 200]);
    expect(await readUserIdsByEmails(devEmails)).toHaveLength(DEV_ACCOUNTS.users.length);
  }, 30_000);
});

describe("本番の worker と同じ app", () => {
  test("APP_ENV が未設定・production・誤記・test のどれでも、試験用の route と開発者ホーム (POST /testing/v1/*) が無い", async () => {
    const previous = process.env.APP_ENV;
    const statuses: Record<string, number[]> = {};
    try {
      for (const value of [undefined, "production", "prodution", "test"]) {
        if (value === undefined) delete process.env.APP_ENV;
        else process.env.APP_ENV = value;
        const app = buildApp({ mountStatic: () => {} });
        const responses = await Promise.all(
          [
            `${TESTING_PATH}/signed-in-users`,
            `${TESTING_PATH}/current-company`,
            `${TESTING_PATH}/account-picker`,
            DEV_HOME_SIGN_IN_PATH,
            DEV_HOME_SIGN_OUT_PATH,
          ].map((path) =>
            app.request(path, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{}",
            }),
          ),
        );
        statuses[value ?? "(unset)"] = responses.map((response) => response.status);
      }
    } finally {
      if (previous === undefined) delete process.env.APP_ENV;
      else process.env.APP_ENV = previous;
    }

    expect(statuses).toEqual({
      "(unset)": [404, 404, 404, 404, 404],
      production: [404, 404, 404, 404, 404],
      prodution: [404, 404, 404, 404, 404],
      test: [404, 404, 404, 404, 404],
    });
  });

  test("共通ログイン画面の URL に、開発用アカウントの一覧を返さない", async () => {
    const app = buildApp({ mountStatic: () => {} });

    const body = await (await app.request(SIGN_IN_PATH)).text();

    for (const email of devEmails) expect(body).not.toContain(email);
  });
});
