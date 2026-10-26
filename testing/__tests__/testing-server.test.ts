import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTestingClient,
  DEV_HOME_PATH,
  type SignedInUser,
  TESTING_PATH,
} from "@taimei-code/auth-client/testing";
import { deleteCompaniesByNames, deleteUsersByIds } from "../../db/testing/cleanup";
import { DEV_ACCOUNTS } from "../../db/testing/dev-accounts";
import { readUserIdsByEmails } from "../../db/testing/read";
import { buildApp } from "../../src/app";
import { getTrustedOrigins } from "../../src/env";
import { DEV_HOME_SIGN_IN_PATH } from "../dev-home";
import { REDIRECT_HOSTS_NOT_SWAPPED_IN_SERVER } from "../non-production-redirect-hosts-check";
import { nonProductionRoutes } from "../non-production-routes";
import { OUTSIDE_PRODUCTION_ONLY_MESSAGE } from "../serve-only-outside-production";
import { AUTH_HOST_ORIGIN } from "./origins";
import { devHomePropsOf, PAGE_PROPS_NOT_IN_PAGE } from "./page-props-of";

const TESTING_ENTRY = join(import.meta.dir, "../server.ts");

const unusedPort = () => {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() });
  const { port } = probe;
  probe.stop(true);
  if (port === undefined) throw new Error("Bun.serve did not bind a TCP port");
  return port;
};

const testingServerEnv = (appEnv: string | undefined, port: number) => {
  const env = { ...process.env, APP_ENV: appEnv, PORT: String(port), AUTH_TRUSTED_PROXY_HOPS: "0" };
  if (appEnv === undefined) delete env.APP_ENV;
  return env;
};

const REDIRECT_HOSTS_PLUGIN = join(import.meta.dir, "../redirect-hosts-plugin.ts");

const testingServerCommand = [
  process.execPath,
  `--preload=${REDIRECT_HOSTS_PLUGIN}`,
  TESTING_ENTRY,
];

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

const withTestingServer = async <A>(
  run: (baseUrl: string) => Promise<A>,
  env: Record<string, string> = {},
): Promise<A> => {
  const port = unusedPort();
  const child = Bun.spawn(testingServerCommand, {
    cwd: tmpdir(),
    env: { ...testingServerEnv("test", port), ...env },
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

describe("試験用の entry は本番以外の APP_ENV の時だけ起動する", () => {
  test.each([
    ["APP_ENV が未設定", undefined],
    ["APP_ENV=production", "production"],
    ["APP_ENV が誤記", "prodution"],
  ])("%s なら、boot の前に本番以外の APP_ENV を求めて 0 以外で終わる (worker の入口と同じ文言)", (_, appEnv) => {
    const result = Bun.spawnSync(testingServerCommand, {
      cwd: tmpdir(),
      env: testingServerEnv(appEnv, unusedPort()),
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toBe(`${OUTSIDE_PRODUCTION_ONLY_MESSAGE}\n`);
    expect(result.stdout.toString()).toBe("");
  });

  test("DATABASE_URL が local の DB でなければ、本番以外の表を書く前に 0 以外で終わり、host を出す", () => {
    const result = Bun.spawnSync(testingServerCommand, {
      cwd: tmpdir(),
      env: {
        ...testingServerEnv("test", unusedPort()),
        DATABASE_URL: "postgres://postgres@db.example.com:5432/auth",
      },
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('DB の host "db.example.com" は local の DB');
  });

  test("AUTH_SERVICE_KEY が無ければ、APP_ENV=test でも 0 以外で終わり、鍵を求める", () => {
    const env: Record<string, string | undefined> = testingServerEnv("test", unusedPort());
    delete env.AUTH_SERVICE_KEY;
    const result = Bun.spawnSync(testingServerCommand, { cwd: tmpdir(), env });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("FATAL: AUTH_SERVICE_KEY is required");
  });

  test("redirect 先の差し替えの preload が無ければ、APP_ENV=test でも 0 以外で終わり、preload を求める", () => {
    const result = Bun.spawnSync([process.execPath, TESTING_ENTRY], {
      cwd: tmpdir(),
      env: testingServerEnv("test", unusedPort()),
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain(REDIRECT_HOSTS_NOT_SWAPPED_IN_SERVER);
  });

  test("APP_ENV=development でも、worker の入口と同じく起動して /health に 200 を返す", async () => {
    const status = await withTestingServer(
      async (baseUrl) => (await fetch(`${baseUrl}/health`)).status,
      { APP_ENV: "development" },
    );

    expect(status).toBe(200);
  }, 15_000);

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

describe("試験の環境の server は、client の IP を proxy の段数と x-forwarded-for から決める", () => {
  test("AUTH_TRUSTED_PROXY_HOPS=1 で x-forwarded-for を付けて loginUrl を開くと、session の IP はその IP になる", async () => {
    const ipAddress = await withTestingServer(
      async (baseUrl) => {
        const { loginUrl } = await createTestingClient(baseUrl).createSignedInUser({
          companies: [],
          returnTo: `${getTrustedOrigins()[0]}/`,
        });
        const { pathname, search } = new URL(loginUrl);
        const login = await fetch(`${baseUrl}${pathname}${search}`, {
          headers: { "x-forwarded-for": "203.0.113.5" },
          redirect: "manual",
        });
        const session = await fetch(`${baseUrl}/api/auth/get-session`, {
          headers: { cookie: sessionTokenCookieWithoutCookieCache(login) },
        });
        return ((await session.json()) as { session: { ipAddress: string } }).session.ipAddress;
      },
      { AUTH_TRUSTED_PROXY_HOPS: "1" },
    );

    expect(ipAddress).toBe("203.0.113.5");
  }, 15_000);
});

describe("試験の環境の server は、taimei-auth 自身の e2e だけが使うログイン URL の試験 API を載せない", () => {
  test("既存の利用者の email でログイン URL を求める POST は 404", async () => {
    const [owner] = DEV_ACCOUNTS.users;
    if (!owner) throw new Error("DEV_ACCOUNTS has no owner");
    const status = await withTestingServer(
      async (baseUrl) =>
        (
          await fetch(`${baseUrl}${TESTING_PATH}/login-links`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: owner.email, returnTo: `${getTrustedOrigins()[0]}/` }),
          })
        ).status,
    );

    expect(status).toBe(404);
  }, 15_000);
});

describe("試験用の entry は、起動の前に開発用アカウントをそろえ、共通ログイン画面は本番と同じ画面を返す", () => {
  test("共通ログイン画面の URL は、本番以外の画面を返さない", async () => {
    const body = await withTestingServer(async (baseUrl) =>
      (await fetch(`${baseUrl}${SIGN_IN_PATH}`)).text(),
    );

    expect(() => devHomePropsOf(body)).toThrow(PAGE_PROPS_NOT_IN_PAGE);
  }, 15_000);

  test("以前の共通ログイン画面の一覧が送っていた、利用者を選ぶ POST は 404", async () => {
    const [owner] = DEV_ACCOUNTS.users;
    if (!owner) throw new Error("DEV_ACCOUNTS has no owner");
    const status = await withTestingServer(
      async (baseUrl) =>
        (
          await fetch(`${baseUrl}${TESTING_PATH}/account-picker${SIGN_IN_QUERY}`, {
            method: "POST",
            headers: { origin: AUTH_HOST_ORIGIN },
            body: new URLSearchParams({ userId: owner.id }),
            redirect: "manual",
          })
        ).status,
    );

    expect(status).toBe(404);
  }, 15_000);

  test("開発者ホームで選んだアカウントの session は、entry を起動し直しても TTL store に残る", async () => {
    const [owner] = DEV_ACCOUNTS.users;
    if (!owner) throw new Error("DEV_ACCOUNTS has no owner");

    const sessionCookie = await withTestingServer(async (baseUrl) => {
      const picked = await fetch(`${baseUrl}${DEV_HOME_SIGN_IN_PATH}${SIGN_IN_QUERY}`, {
        method: "POST",
        headers: { origin: AUTH_HOST_ORIGIN },
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

describe("試験用の entry は、開発環境と同じ開発者ホームを載せる", () => {
  test("開発者ホームを開くと、開発用アカウントの一覧を返す", async () => {
    const { status, body } = await withTestingServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}${DEV_HOME_PATH}`);
      return { status: response.status, body: await response.text() };
    });

    expect(status).toBe(200);
    expect(devHomePropsOf(body).devAccounts.map(({ email }) => email)).toEqual(devEmails);
  }, 15_000);
});

describe("本番の worker と同じ app", () => {
  test("APP_ENV が未設定・production・誤記・test のどれでも、本番以外の route の POST が無い", async () => {
    const postPaths = [
      ...new Set(
        nonProductionRoutes({ e2eLoginLinks: true })
          .flatMap((routes) => routes.routes)
          .filter((route) => route.method === "POST")
          .map((route) => route.path),
      ),
    ];
    const previous = process.env.APP_ENV;
    const statuses: Record<string, number[]> = {};
    try {
      for (const value of [undefined, "production", "prodution", "test"]) {
        if (value === undefined) delete process.env.APP_ENV;
        else process.env.APP_ENV = value;
        const app = buildApp({ mountStatic: () => {} });
        const responses = await Promise.all(
          postPaths.map((path) =>
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

    expect(postPaths.length).toBeGreaterThan(3);
    const allNotFound = postPaths.map(() => 404);
    expect(statuses).toEqual({
      "(unset)": allNotFound,
      production: allNotFound,
      prodution: allNotFound,
      test: allNotFound,
    });
  });
});
