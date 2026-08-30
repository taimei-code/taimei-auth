import { findTwoFactorVerificationState } from "@/db/repositories/two-factor";
import { auth } from "../auth";
import { Sentry } from "../sentry";
import {
  ALREADY_ENABLED,
  CHALLENGE_EXPIRED,
  failure,
  mapPluginError,
  mapTwoFactorError,
  type MfaFailure,
} from "./error-mapping";
import type { MfaActor, TotpEnrollment } from "./registration/contracts";
import type { MfaCodeKind } from "./wire-contracts";

// twoFactor プラグイン (auth.api.*) と auth.$context への唯一の正規窓口 (規律の正本: ADR-0013 §2)。
// **すべての呼び出しで headers のみを渡し request を渡さないこと** — 生 path 遮断の before-hook は
// ctx.request の有無でブラウザ由来かを判定するため、request を渡すと自分の呼び出しが 403 で自滅する。

export type GatewayResult<T> = { ok: true; value: T; headers: Headers } | MfaFailure;

export type { TotpEnrollment };

// プラグインの失敗 (APIError throw) の Result 化はこの 1 箇所に閉じる。成功時の headers に載る
// Set-Cookie を転送しないと操作直後にログアウトするため、handler まで必ず運ぶこと。
// 既定 = 未知を rethrow / 総写像 (第 2 引数 false) = 未知も既知へ畳む。使い分けの正本: ADR-0013 §8。
async function invoke<T>(
  call: () => Promise<{ headers?: Headers; response: T }>,
  preserveUnknown = true,
): Promise<GatewayResult<T>> {
  try {
    const { headers, response } = await call();
    return {
      ok: true as const,
      value: response,
      headers: headers ?? new Headers(),
    };
  } catch (error) {
    const mapped = preserveUnknown ? mapPluginError(error) : mapTwoFactorError(error);
    if (!mapped) throw error;
    return failure(mapped);
  }
}

// auth.$context を触れるのはこの gateway と challenge-store の 2 ファイルだけ。
export function getAuthContext(): typeof auth.$context {
  return auth.$context;
}

// 対象 user は headers のセッションから決まり、requireActor も同じ headers から解決するため両者は同一 user。
export async function enrollTotp(headers: Headers): Promise<GatewayResult<TotpEnrollment>> {
  const result = await invoke(() =>
    auth.api.enableTwoFactor({ body: {}, headers, returnHeaders: true }),
  );
  if (!result.ok) return result;
  return {
    ok: true,
    value: { totpUri: result.value.totpURI, recoveryCodes: result.value.backupCodes },
    headers: result.headers,
  };
}

export async function readPendingTotpEnrollment(
  actor: MfaActor,
  headers: Headers,
): Promise<GatewayResult<TotpEnrollment>> {
  // 未 verified 行の存在をここでも検証する (多層防御)。プラグインの getTOTPURI / viewBackupCodes は
  // verified を見ないため、将来の呼び出し元が有効ユーザーの実 secret と平文コードを引き出せてしまう。
  // 前段 SELECT も総写像に含める — throw 素通しは guard を残置し「読み取り = 総写像」を破る (ADR-0013 §8)。
  const current = await findTwoFactorVerificationState(actor.id).catch((error: unknown) => {
    Sentry.captureException(error, { tags: { component: "mfa-gateway" } });
    return undefined;
  });
  if (!current) return failure(CHALLENGE_EXPIRED);
  if (current.verified) return failure(ALREADY_ENABLED);

  const [uri, codes] = await Promise.all([
    invoke(() => auth.api.getTOTPURI({ body: {}, headers, returnHeaders: true }), false),
    invoke(
      () =>
        auth.api.viewBackupCodes({ body: { userId: actor.id } }).then((response) => ({ response })),
      false,
    ),
  ]);
  if (!uri.ok) return uri;
  if (!codes.ok) return codes;
  return {
    ok: true,
    value: { totpUri: uri.value.totpURI, recoveryCodes: codes.value.backupCodes },
    headers: uri.headers,
  };
}

// セッション無し (チャレンジ) とセッションあり (disable) の両経路が通る。プラグインの試行制限と
// アカウントロックはセッション無しでのみ働き、セッションありには継承されない (ADR-0013 Consequences)。
export function verifyMfaCode(
  headers: Headers,
  input: { code: string; kind: MfaCodeKind },
): Promise<GatewayResult<unknown>> {
  return invoke(verifyCall(headers, input));
}

// 総写像入口。import 元は complete-challenge.ts のみ (containment で固定)。理由の正本: ADR-0013 §8。
export function verifyMfaCodeWithoutGuard(
  headers: Headers,
  input: { code: string; kind: MfaCodeKind },
): Promise<GatewayResult<unknown>> {
  return invoke(verifyCall(headers, input), false);
}

function verifyCall(
  headers: Headers,
  input: { code: string; kind: MfaCodeKind },
): () => Promise<{ headers?: Headers; response: unknown }> {
  return input.kind === "totp"
    ? () => auth.api.verifyTOTP({ body: { code: input.code }, headers, returnHeaders: true })
    : () => auth.api.verifyBackupCode({ body: { code: input.code }, headers, returnHeaders: true });
}

// verifyTOTP は未 verified 行を **flag の値に関わらず** verified へ更新し、flag が false なら
// フラグ立て + セッション rotate も行う (better-auth 1.6.23)。純粋な検証になるのは「有効」時だけで、
// この行修復が「中断した有効化」の唯一の自己復旧口を支える (帰結の正本: ADR-0013 §7)。
export function activateTotp(headers: Headers, code: string): Promise<GatewayResult<unknown>> {
  return verifyMfaCode(headers, { code, kind: "totp" });
}

// 行削除とフラグ降ろしはプラグインが行う。本人確認はしないため、verifyMfaCode 成功後にのみ呼ぶこと。
export function disableTotp(headers: Headers): Promise<GatewayResult<unknown>> {
  return invoke(() => auth.api.disableTwoFactor({ body: {}, headers, returnHeaders: true }));
}

// secondaryStorage 構成では session 実体が Redis にしか無く、フラグ更新は revision トリガー対象外の
// ため、これが既存セッション失効の唯一の経路 (ADR-0013 Consequences)。
export function revokeOtherSessions(headers: Headers): Promise<GatewayResult<unknown>> {
  return invoke(() => auth.api.revokeOtherSessions({ headers, returnHeaders: true }));
}

// 運用救済専用のフラグ降ろし。リクエストもセッションも無く auth.api の disable は使えない。
// drizzle 直更新でなく internalAdapter を通す理由: db/CLAUDE.md ルール 2 の User 更新例外。
export async function clearTwoFactorEnabled(userId: string): Promise<void> {
  const authContext = await auth.$context;
  await authContext.internalAdapter.updateUser(userId, { twoFactorEnabled: false });
}

// 引数を MfaActor に、戻り値を残数に絞ることで viewBackupCodes を IDOR にしない (型 tripwire: QA-M-14)。
// この 2 点を緩めないこと。呼び出しは MFA 有効ユーザーに限る契約のため、失敗は想定外 —
// 残数 0 に縮退させたうえで観測する。
export async function countRemainingRecoveryCodes(actor: MfaActor): Promise<number> {
  return auth.api
    .viewBackupCodes({ body: { userId: actor.id } })
    .then((result) => result.backupCodes.length)
    .catch((error: unknown) => {
      Sentry.captureException(error, { tags: { component: "mfa-gateway" } });
      return 0;
    });
}
