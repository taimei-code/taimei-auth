import { describe, expect, test } from "bun:test";
import { partial } from "../../__tests__/live-runner";
import { Effect, Layer } from "effect";
import { CLIENT_IP_HEADER } from "../../client-ip";
import { signedIn, signedOut } from "../../membership/__tests__/test-layers";
import { PasskeyRepo } from "../../passkey/ports";
import { JSON_HEADERS } from "../client-facing-error";
import { buildAppWith, freshSessionCookie } from "./helpers";

const USED = {
  id: "pk-used",
  userId: "u1",
  credentialId: "Y3JlZGVudGlhbA",
  publicKey: new Uint8Array([1, 2, 3]),
  counter: 0,
  aaguid: "00000000-0000-0000-0000-000000000000",
  transports: [],
  createdAt: new Date("2026-11-01T00:00:00.000Z"),
  lastUsedAt: new Date("2026-11-02T03:04:05.678Z") as Date | null,
};
const UNUSED = { ...USED, id: "pk-unused", lastUsedAt: null };

const passkeyRepoWith = (rows: (typeof USED)[]) =>
  Layer.succeed(
    PasskeyRepo,
    partial<PasskeyRepo["Service"]>({ listPasskeys: () => Effect.succeed(rows) }),
  );

describe("パスキーの一覧の API の応答", () => {
  test("使ったパスキーは最後に使った日時を ISO 8601 の文字列で、未使用のパスキーは null で返す", async () => {
    const app = buildAppWith(Layer.mergeAll(signedIn(), passkeyRepoWith([USED, UNUSED])));

    const res = await app.request("/api/account/passkeys", {
      headers: { ...JSON_HEADERS, ...freshSessionCookie() },
    });

    expect(await res.json<unknown>()).toEqual({
      passkeys: [
        {
          id: "pk-used",
          created_at: "2026-11-01T00:00:00.000Z",
          last_used_at: "2026-11-02T03:04:05.678Z",
        },
        { id: "pk-unused", created_at: "2026-11-01T00:00:00.000Z", last_used_at: null },
      ],
      can_register: true,
    });
  });

  test("未ログインの要求は試行枠を数える前に 401 になり、同じ IP から 11 回送っても 429 にならない", async () => {
    const app = buildAppWith(signedOut());
    const ip = `2001:db8::${crypto.randomUUID().slice(0, 4)}`;

    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await app.request("/api/account/passkeys", {
        headers: { ...JSON_HEADERS, [CLIENT_IP_HEADER]: ip },
      });
      statuses.push(res.status);
    }

    expect(new Set(statuses)).toEqual(new Set([401]));
  });
});
