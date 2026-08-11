import { auth } from "../auth";
import type { Actor } from "../membership/guard/core";
import { Sentry } from "../sentry";
import { failure, mapTwoFactorError, type MfaFailure } from "./error-mapping";

// twoFactor プラグイン (auth.api.*) と auth.$context への唯一の正規窓口。
// src/account/revoke-sessions.ts と同じ「窓口 1 ファイル」規律で、プラグインの呼び出し方 —
// 副作用の有無・セッション rotate の発生点・エラーの投げ方 — の知識をここから外に出さない。
// use-case は Result union と Headers だけを受け取る。
//
// **すべての呼び出しで headers のみを渡し request を渡さないこと**。生 /two-factor/* を遮断する
// before-hook (src/auth-plugins/mfa-challenge.ts) は path でなく ctx.request の有無で
// ブラウザ由来かを判定するため、ここで request を渡すと自分の呼び出しが 403 で自滅する。
// 設計詳細: docs/adr/0013-mfa-totp-challenge.md

export type GatewayResult<T> = { ok: true; value: T; headers: Headers } | MfaFailure;

export type TotpEnrollment = { totpUri: string; recoveryCodes: string[] };

export type MfaCodeKind = "totp" | "recovery_code";

// プラグインは失敗を APIError の throw で返すため、Result 化はこの 1 箇所に閉じる。
// 成功時の headers には Set-Cookie (セッション rotate / チャレンジ cookie 失効) が載りうる。
// 転送しないと操作直後にログアウトするため、呼び出し側は必ず handler まで運ぶこと。
async function invoke<T>(
  call: () => Promise<{ headers?: Headers; response: T }>,
): Promise<GatewayResult<T>> {
  return call()
    .then(({ headers, response }) => ({
      ok: true as const,
      value: response,
      headers: headers ?? new Headers(),
    }))
    .catch((error: unknown) => failure(mapTwoFactorError(error)));
}

// 複数の gateway 呼び出しをまたいで Set-Cookie を 1 本の Headers に束ねる。
// 後段の呼び出しが前段の cookie を上書きしないよう append で積む (セッション rotate と
// チャレンジ cookie 失効が同じ response に同居する)。
export function mergeForwardedCookies(...sources: Headers[]): Headers {
  const merged = new Headers();
  for (const source of sources) {
    for (const cookie of source.getSetCookie()) merged.append("set-cookie", cookie);
  }
  return merged;
}

// challenge-store が cookie 名の導出と verification value の読み書きに使う。
// auth.$context を触れるのはこの 2 ファイルだけ。
export function getAuthContext(): typeof auth.$context {
  return auth.$context;
}

// 対象 user は headers のセッションから決まる (プラグイン側の sessionMiddleware)。
// requireActor も同じ headers から Actor を解決するため、両者は必ず同一 user を指す。
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

// セッション無し (チャレンジ) 経路とセッションあり (disable) 経路の両方が通る。
// プラグインは session の有無で挙動を変える: セッション無しなら試行カウント 5 回で
// チャレンジ破棄・アカウント 10 回で 15 分ロックが働き、成功時に新セッションを発行する。
// セッションありなら試行制限は一切働かない (呼び出し側が rate limit を自前で持つこと)。
export function verifyMfaCode(
  headers: Headers,
  input: { code: string; kind: MfaCodeKind },
): Promise<GatewayResult<unknown>> {
  return input.kind === "totp"
    ? invoke(() =>
        auth.api.verifyTOTP({ body: { code: input.code }, headers, returnHeaders: true }),
      )
    : invoke(() =>
        auth.api.verifyBackupCode({ body: { code: input.code }, headers, returnHeaders: true }),
      );
}

// verifyTOTP は two_factor 行が未 verified なら **flag の値に関わらず** 行を verified へ更新し、
// さらに user.twoFactorEnabled が false のときはフラグ立て + セッション rotate も行う
// (better-auth 1.6.23 totp/index.mjs。順序はフラグ立て → rotate → 行 verified 化)。
// 純粋な検証になるのは「有効」(verified 行 + flag true) のときだけ — この行修復が
// 「中断した有効化」からの唯一の自己復旧口を支える (帰結の正本: ADR-0013 §7)。
// この非対称を呼び出し側に持ち出さないため、活性化の意図を名前で表明する。
export function activateTotp(headers: Headers, code: string): Promise<GatewayResult<unknown>> {
  return verifyMfaCode(headers, { code, kind: "totp" });
}

// two_factor 行の削除と twoFactorEnabled: false をプラグインが行い、セッションを rotate する。
// コードの本人確認は行わないため、呼び出し側が verifyMfaCode 成功後にのみ呼ぶこと。
export function disableTotp(headers: Headers): Promise<GatewayResult<unknown>> {
  return invoke(() => auth.api.disableTwoFactor({ body: {}, headers, returnHeaders: true }));
}

// 現セッション以外を revoke する。secondaryStorage 構成では session 実体が Redis にしか無く、
// これが既存セッション失効の唯一の経路 (user.two_factor_enabled の更新は revision トリガーの
// 対象列でないため、フラグ更新だけでは他デバイスのセッションは失効しない)。
export function revokeOtherSessions(headers: Headers): Promise<GatewayResult<unknown>> {
  return invoke(() => auth.api.revokeOtherSessions({ headers, returnHeaders: true }));
}

// 運用救済スクリプト専用のフラグ降ろし。リクエストもセッションも無いため auth.api の disable は
// 使えない。それでも drizzle で user 行を直更新せず internalAdapter を通すのは、better-auth が
// user を secondaryStorage にも二重保管しており、cache 無効化を lifecycle hook に委ねる必要が
// あるため (db/CLAUDE.md ルール 2 の User 更新に関する例外規定)。
export async function clearTwoFactorEnabled(userId: string): Promise<void> {
  const authContext = await auth.$context;
  await authContext.internalAdapter.updateUser(userId, { twoFactorEnabled: false });
}

// 引数を Actor に、戻り値を残数 (number) に絞ることで、任意 userId の平文リカバリーコードを
// 引ける viewBackupCodes を IDOR にしない。string の userId を渡せない・コード配列を受け取れない
// という制約を型で表明しているので、この 2 点を緩めないこと。
//
// 呼び出しは MFA 有効ユーザーに限る契約 (行が存在する)。したがって失敗は想定外であり、
// 残数 0 に縮退させたうえで観測する。
export async function countRemainingRecoveryCodes(actor: Actor): Promise<number> {
  return auth.api
    .viewBackupCodes({ body: { userId: actor.id } })
    .then((result) => result.backupCodes.length)
    .catch((error: unknown) => {
      Sentry.captureException(error, { tags: { component: "mfa-gateway" } });
      return 0;
    });
}
