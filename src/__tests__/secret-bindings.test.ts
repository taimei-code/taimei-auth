import { afterEach, describe, expect, test } from "bun:test";
import {
  resolveSecretBindings,
  resolveSecretsBeforeHandler,
  SECRET_BINDING_NAMES,
} from "../secret-bindings";

const secretStoreBinding = (value: string) => ({ get: async () => value });

const savedEnv = { ...process.env };

const envValue = (name: string) => process.env[name];

afterEach(() => {
  for (const name of Object.keys(process.env)) {
    if (!(name in savedEnv)) delete process.env[name];
  }
  Object.assign(process.env, savedEnv);
});

describe("Secrets Store の binding は、最初の request の前に process.env の値になる", () => {
  test("binding にする secret は、本番の Worker が持つ 8 つ", () => {
    expect([...SECRET_BINDING_NAMES]).toEqual([
      "AUTH_SECRET",
      "AUTH_SERVICE_KEY",
      "AUTH_RESEND_KEY",
      "MFA_TOTP_ENCRYPTION_KEYS",
      "AUTH_GITHUB_ID",
      "AUTH_GITHUB_SECRET",
      "BLOB_READ_WRITE_TOKEN",
      "SENTRY_DSN",
    ]);
  });

  test("一覧にある名前の get を持つ binding は、get の値が process.env に入る", async () => {
    delete process.env.AUTH_SECRET;

    await resolveSecretBindings({ AUTH_SECRET: secretStoreBinding("from-secrets-store") });

    expect(envValue("AUTH_SECRET")).toBe("from-secrets-store");
  });

  test("一覧に無い名前の get を持つ値 (Durable Object の namespace など) は呼ばない", async () => {
    let calls = 0;
    const namespace = {
      get: async () => {
        calls += 1;
        return "stub";
      },
    };

    await resolveSecretBindings({ KV_STORE: namespace });

    expect(calls).toBe(0);
    expect(envValue("KV_STORE")).toBeUndefined();
  });

  test("文字列の binding (wrangler secret put の secret) の値は変えない", async () => {
    process.env.AUTH_SECRET = "plain-secret";

    await resolveSecretBindings({ AUTH_SECRET: "plain-secret" });

    expect(envValue("AUTH_SECRET")).toBe("plain-secret");
  });

  test("一覧にある名前の文字列の binding は、Sentry が読む前に process.env に写る", async () => {
    delete process.env.SENTRY_DSN;

    await resolveSecretBindings({ SENTRY_DSN: "https://public@example.com/1" });

    expect(envValue("SENTRY_DSN")).toBe("https://public@example.com/1");
  });

  test("SENTRY_DSN の Secrets Store の binding は、get の値の文字列になる", async () => {
    delete process.env.SENTRY_DSN;

    await resolveSecretBindings({ SENTRY_DSN: secretStoreBinding("https://public@example.com/2") });

    expect(envValue("SENTRY_DSN")).toBe("https://public@example.com/2");
  });
});

describe("secret を解いてから中の handler を呼ぶ (Sentry の options は中の handler が呼ばれる時に DSN を読む)", () => {
  const request = new Request("https://auth.example.com/health");

  test("中の handler が呼ばれる時には、一覧の secret が process.env にある", async () => {
    delete process.env.SENTRY_DSN;
    let seen: string | undefined;
    const handler = resolveSecretsBeforeHandler({
      fetch: async () => {
        seen = envValue("SENTRY_DSN");
        return new Response("ok");
      },
    });

    await handler.fetch(
      request,
      { SENTRY_DSN: secretStoreBinding("https://public@example.com/3") },
      {},
    );

    expect(seen).toBe("https://public@example.com/3");
  });

  test("解決に失敗した request の次の request で、解決をやり直してから中の handler を呼ぶ", async () => {
    delete process.env.AUTH_SECRET;
    let attempts = 0;
    const flaky = {
      get: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("secrets store unavailable");
        return "resolved-on-retry";
      },
    };
    const handler = resolveSecretsBeforeHandler({
      fetch: async () => new Response(envValue("AUTH_SECRET")),
    });

    await expect(handler.fetch(request, { AUTH_SECRET: flaky }, {})).rejects.toThrow();
    const response = await handler.fetch(request, { AUTH_SECRET: flaky }, {});

    expect(await response.text()).toBe("resolved-on-retry");
  });
});
