import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { app } from "../index";
import { createSeedHelpers } from "../handlers/__tests__/helpers";
import { RAW_TWO_FACTOR_PATHS } from "../mfa/blocked-paths";
import { enrollTotp } from "../mfa/gateway";
import { createSessionFor } from "../mfa/__tests__/helpers";

// プラグインの生 endpoint がブラウザから到達不能であることの統合テスト。
// 認可スモークは Hono route しか見ないので、better-auth 側にマウントされたこの表面は別建てで
// 固定する。迂回されると sign_in audit の記帳とチャレンジ状態の掃除がまとめてバイパスされる。

const P = "mfa-rawpath-";
const { cleanup, seedUser } = createSeedHelpers(P);

const AUTH_MOUNT = "http://localhost/api/auth";

// 生 path をブラウザから叩いた時の response。before-hook は ctx.request の有無で
// ブラウザ由来を判定するため、HTTP 経由でしか再現しない。
const postRaw = async (path: string): Promise<Response> =>
  app.request(`${AUTH_MOUNT}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });

// test.each は mutable な配列を要求するため、カタログのまま渡さずコピーを作る
// (カタログ側を mutable にすると path が書き換え可能になる)。
const BLOCKED_PATHS: string[] = [...RAW_TWO_FACTOR_PATHS];

describe("生 two-factor path の遮断", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test.each(BLOCKED_PATHS)("QA-E-02 POST %s → 403", async (path) => {
    const res = await postRaw(path);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "TWO_FACTOR_ROUTE_BLOCKED" });
  });

  test.each(BLOCKED_PATHS)("QA-E-02 正規化ゆらぎ %s も endpoint に到達しない", async (path) => {
    const variants = [
      `${path}/`,
      path.toUpperCase(),
      path.replace(/\/(?!two)/g, "%2F"),
      `${path}?x=1`,
    ];

    for (const variant of variants) {
      const res = await postRaw(variant);
      // 403 は before-hook が止めた形、404 は router がそもそも endpoint に解決しなかった形。
      // どちらでも到達はしていないが、2xx/3xx が出たら迂回経路が開いている。
      expect([403, 404]).toContain(res.status);
    }
  });

  test("QA-E-02 gateway の server-side 呼び出しは遮断されない", async () => {
    const user = await seedUser("gateway");
    const session = await createSessionFor(user.id);

    const enrolled = await enrollTotp(session.headers);

    // 遮断の判定材料を path でなく request の有無に置いている理由がこれ。path で切ると
    // 自前 REST の裏側 (auth.api.*) まで巻き添えで 403 になり MFA 機能自体が使えなくなる。
    expect(enrolled.ok).toBe(true);
  });
});
