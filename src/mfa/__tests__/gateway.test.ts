import { afterAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createSeedHelpers } from "../../handlers/__tests__/helpers";
import { db } from "@/db/client";
import { auth } from "../../auth";
import {
  countRemainingRecoveryCodes,
  enrollTotp,
  readPendingTotpEnrollment,
  verifyMfaCode,
} from "../gateway";
import { mergeForwardedCookies } from "../session-headers";
import {
  actorOf,
  awaitNextTotpStep,
  createSessionFor,
  currentTotpStep,
  enableMfaFor,
  installSentryRecorder,
  totpCode,
  wrongTotpCode,
} from "./helpers";

// 総写像テストで Sentry (unmapped 通報) が発火するため recorder を入れ、後続ファイルへ漏らさない。
const sentry = installSentryRecorder();
afterAll(() => sentry.restore());

// gateway (src/mfa/gateway.ts) 経由の検証挙動。プラグインの検証窓は @better-auth/utils の既定
// (±1 step) で、totpOptions に窓を指定する option が存在しない — つまり窓の広さは
// 「通る / 通らない」でしか固定できず、依存更新で黙って広がってもここでしか気付けない。
// セッションあり経路を使うのは、試行カウントとロックを挟まず窓だけを測るため。

const P = "mfa-gateway-";
const { cleanup, seedUser } = createSeedHelpers(P);

test("複数 source の Set-Cookie を入力順で保持する", () => {
  const first = new Headers();
  first.append("set-cookie", "session=first");
  first.append("set-cookie", "challenge=first");
  const second = new Headers();
  second.append("set-cookie", "session=second");

  expect(mergeForwardedCookies(first, second).getSetCookie()).toEqual([
    "session=first",
    "challenge=first",
    "session=second",
  ]);
});

describe("gateway の TOTP 検証", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("QA-M-25 検証窓 ±1 step", async () => {
    const user = await seedUser("m25");
    const enabled = await enableMfaFor(user);

    const verifyAt = async (stepOffset: number): Promise<boolean> => {
      const result = await verifyMfaCode(enabled.session.headers, {
        code: await totpCode(enabled.secret, stepOffset),
        kind: "totp",
      });
      return result.ok;
    };

    // 5 回の検証の途中で step が進むと offset がまるごと 1 つずれ、窓の外を測ったつもりで
    // 窓の内側を測る。同一 step 内で測り切れたかを前後比較で確かめ、跨いだ観測は捨てる。
    const probeWindowWithinOneStep = async (): Promise<boolean[] | null> => {
      const startedAt = currentTotpStep();
      const accepted: boolean[] = [];
      for (const stepOffset of [0, -1, 1, -2, 2]) accepted.push(await verifyAt(stepOffset));
      return currentTotpStep() === startedAt ? accepted : null;
    };

    let accepted = await probeWindowWithinOneStep();
    for (let retry = 0; accepted === null && retry < 3; retry++) {
      await awaitNextTotpStep();
      accepted = await probeWindowWithinOneStep();
    }
    if (accepted === null) throw new Error("could not observe the window inside a single step");

    expect(accepted).toEqual([true, true, true, false, false]);
  });

  test("kind による検証先の切り替え (TOTP コードはリカバリーコードとして通らない)", async () => {
    const user = await seedUser("kind");
    const enabled = await enableMfaFor(user);

    const asRecovery = await verifyMfaCode(enabled.session.headers, {
      code: await totpCode(enabled.secret),
      kind: "recovery_code",
    });
    const asTotp = await verifyMfaCode(enabled.session.headers, {
      code: enabled.recoveryCodes[0],
      kind: "totp",
    });

    expect(asRecovery).toEqual({ ok: false, error: "invalid_code", status: 400 });
    expect(asTotp).toEqual({ ok: false, error: "invalid_code", status: 400 });
    // 誤 kind で消費されていないこと (リカバリーコードは単回使用なので取り違えは実損になる)。
    expect(await countRemainingRecoveryCodes(enabled.actor)).toBe(enabled.recoveryCodes.length);
  });

  test("誤コードは invalid_code に写像され、プラグインのコード文字列を漏らさない", async () => {
    const user = await seedUser("wrong");
    const enabled = await enableMfaFor(user);

    const result = await verifyMfaCode(enabled.session.headers, {
      code: await wrongTotpCode(enabled.secret),
      kind: "totp",
    });

    expect(result).toEqual({ ok: false, error: "invalid_code", status: 400 });
  });

  test("readPendingTotpEnrollment は結果不明も既知の失敗へ畳む (総写像 — AC-009 の gateway 側)", async () => {
    const user = await seedUser("read-total");
    const session = await createSessionFor(user.id);
    const actor = actorOf(user);
    // fixture もテスト対象 module 自身で作る (production 配線一式を引き込まない)。
    const enrolled = await enrollTotp(session.headers);
    if (!enrolled.ok) throw new Error(`enroll failed: ${enrolled.error}`);

    // plugin 由来でない例外を注入 — 読み取りは総写像 (正本: ADR-0013 §8。runner 側の観測: E-RPK)。
    const spy = spyOn(auth.api, "getTOTPURI").mockImplementation((async () => {
      throw new Error("transient decryption failure");
    }) as unknown as typeof auth.api.getTOTPURI);
    try {
      const result = await readPendingTotpEnrollment(actor, session.headers);
      expect(result).toEqual({ ok: false, error: "challenge_expired", status: 401 });
    } finally {
      spy.mockRestore();
    }
  });

  test("readPendingTotpEnrollment は前段 SELECT の失敗も既知の失敗へ畳む (guard を残置させない)", async () => {
    const user = await seedUser("read-db-fail");
    const session = await createSessionFor(user.id);
    const actor = actorOf(user);

    // withFailingAuditWrite と同じ db-level seam。SELECT が投げても総写像が既知へ畳むことを固定する。
    const select = db.select.bind(db);
    const failing = spyOn(db, "select").mockImplementation((() => {
      throw new Error("transient pg failure");
    }) as typeof select);
    try {
      const result = await readPendingTotpEnrollment(actor, session.headers);
      expect(result).toEqual({ ok: false, error: "challenge_expired", status: 401 });
    } finally {
      failing.mockRestore();
    }
  });
});
