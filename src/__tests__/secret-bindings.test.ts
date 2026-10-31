import { afterEach, describe, expect, test } from "bun:test";
import { resolveSecretBindings, SECRET_BINDING_NAMES } from "../secret-bindings";

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
  test("binding にする secret は、動くのに必須の 4 つだけ", () => {
    expect([...SECRET_BINDING_NAMES]).toEqual([
      "AUTH_SECRET",
      "AUTH_SERVICE_KEY",
      "AUTH_RESEND_KEY",
      "MFA_TOTP_ENCRYPTION_KEYS",
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
});
