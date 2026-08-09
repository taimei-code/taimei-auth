import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createSeedHelpers } from "../../handlers/__tests__/helpers";
import { getAppName } from "../../email/client";
import { enroll } from "../enroll";
import {
  actorOf,
  countTwoFactorRows,
  createSessionFor,
  enableMfaFor,
  findTwoFactorRow,
  secretFromTotpUri,
  totpCode,
} from "./helpers";
import { activate } from "../activate";
import { clearTwoFactorEnabled } from "../gateway";

// enroll use-case (src/mfa/enroll.ts) の DB 統合テスト。実際に better-auth の
// enableTwoFactor を通すので、two_factor 行の生成・verified の初期値・再 enroll の収束は
// プラグイン本体の挙動込みで固定される。

const P = "mfa-enroll-";
const { cleanup, seedUser } = createSeedHelpers(P);

describe("enroll", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("QA-H-01 MFA 未設定 → 200 + verified:false 行", async () => {
    const user = await seedUser("h01");
    const session = await createSessionFor(user.id);

    const result = await enroll(actorOf(user), session.headers);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(typeof result.totpUri).toBe("string");
    expect(result.recoveryCodes.length).toBeGreaterThan(0);

    const row = await findTwoFactorRow(user.id);
    expect(row).toBeDefined();
    expect(row?.verified).toBe(false);
    expect(row?.failedVerificationCount).toBe(0);
    expect(row?.lockedUntil).toBeNull();
  });

  test("QA-M-06 totpUri Key URI Format", async () => {
    const user = await seedUser("m06");
    const session = await createSessionFor(user.id);

    const result = await enroll(actorOf(user), session.headers);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const uri = new URL(result.totpUri);
    expect(uri.protocol).toBe("otpauth:");
    expect(uri.host).toBe("totp");
    // label は `issuer:account` (RFC の Key URI Format)。URL の pathname 側に載る。
    expect(decodeURIComponent(uri.pathname)).toBe(`/${getAppName()}:${user.email}`);
    expect(uri.searchParams.get("issuer")).toBe(getAppName());
    expect(uri.searchParams.get("digits")).toBe("6");
    expect(uri.searchParams.get("period")).toBe("30");
    // secret から実際にコードを生成できることまで見ないと、URI の形だけ正しく認証アプリで
    // 通らない状態を素通りさせる。
    expect(await totpCode(secretFromTotpUri(result.totpUri))).toMatch(/^\d{6}$/);
  });

  test("QA-E-01 enabled:true → 409 secret 不変", async () => {
    const user = await seedUser("e01");
    const session = await createSessionFor(user.id);

    const enrolled = await enroll(actorOf(user), session.headers);
    expect(enrolled.ok).toBe(true);
    if (!enrolled.ok) return;
    const activated = await activate({
      actor: actorOf(user),
      headers: session.headers,
      code: await totpCode(secretFromTotpUri(enrolled.totpUri)),
    });
    expect(activated.ok).toBe(true);

    const before = await findTwoFactorRow(user.id);
    const rejected = await enroll(actorOf(user, { twoFactorEnabled: true }), session.headers);
    const after = await findTwoFactorRow(user.id);

    expect(rejected).toEqual({ ok: false, error: "already_enabled", status: 409 });
    // 拒否の実効は「409 を返した」ではなく「手元の認証アプリが通り続ける」ことなので、
    // secret とリカバリーコードの実体が 1 bit も動いていないことを観測値で突き合わせる。
    expect(after?.secret).toBe(before?.secret as string);
    expect(after?.backupCodes).toBe(before?.backupCodes as string);
    expect(after?.verified).toBe(true);
    expect(await countTwoFactorRows(user.id)).toBe(1);
  });

  test("QA-D-07 再 enroll → 200 1 行収束", async () => {
    const user = await seedUser("d07");
    const session = await createSessionFor(user.id);

    const abandoned = await enroll(actorOf(user), session.headers);
    expect(abandoned.ok).toBe(true);
    if (!abandoned.ok) return;

    const reEnrolled = await enroll(actorOf(user), session.headers);
    expect(reEnrolled.ok).toBe(true);
    if (!reEnrolled.ok) return;

    expect(await countTwoFactorRows(user.id)).toBe(1);
    const row = await findTwoFactorRow(user.id);
    expect(row?.verified).toBe(false);
    // 放棄された secret が生き残ると、認証アプリに残った古い登録でも通ってしまう。
    const newSecret = secretFromTotpUri(reEnrolled.totpUri);
    expect(newSecret).not.toBe(secretFromTotpUri(abandoned.totpUri));
    expect(await totpCode(newSecret)).toMatch(/^\d{6}$/);
  });

  test("フラグ降ろしだけ済んだ中断状態 → 409 secret 不変", async () => {
    const user = await seedUser("halfdisabled");
    const enabled = await enableMfaFor(user);
    // プラグインの disable はフラグ降ろし → 行削除の順に書くため、その間で落ちるとこの状態が残る。
    await clearTwoFactorEnabled(user.id);
    const before = await findTwoFactorRow(user.id);
    expect(before?.verified).toBe(true);

    const rejected = await enroll(actorOf(user), enabled.session.headers);

    // フラグだけを見て通すと、プラグインが verified: true を継承した行を作り直し、本人の知らない
    // secret がその場で有効な第二要素になる (手元の認証アプリは通らないまま)。
    expect(rejected).toEqual({ ok: false, error: "already_enabled", status: 409 });
    const after = await findTwoFactorRow(user.id);
    expect(after?.secret).toBe(before?.secret as string);
    expect(after?.backupCodes).toBe(before?.backupCodes as string);
    expect(after?.verified).toBe(true);
    expect(await countTwoFactorRows(user.id)).toBe(1);
  });
});
