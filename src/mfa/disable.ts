import { recordMfaDisabled } from "@/db/repositories/audit-log";
import { captureAuditLogError } from "../audit-error";
import type { Actor } from "../membership/guard/core";
import { getClientContext } from "../request-context";
import type { MfaFailure } from "./error-mapping";
import {
  disableTotp,
  mergeForwardedCookies,
  revokeOtherSessions,
  verifyMfaCode,
  type MfaCodeKind,
} from "./gateway";

// ADR-0012 (Use-case 層): 認証アプリの無効化手続。two_factor 行を削除し
// user.twoFactorEnabled を false に戻す。

export type DisableResult =
  | { ok: true; forwardedHeaders: Headers; notifyEmail: string }
  | MfaFailure;

// 本人確認を先頭に置き、**コードが誤っていれば副作用を 1 つも起こさない**。パスワードを持たない
// 構成では現在の TOTP コードかリカバリーコードだけが「本人が第二要素を今も持っている」証拠で、
// これを後段に回すと誤コードでも他セッションの revoke やセッション rotate が起きてしまう。
// 成功後の順序は activate と同じ (revoke → rotate → audit → 宛先を Result で返す)。
//
// **セッションあり経路にはプラグインの試行制限が一切継承されない** (プラグインの試行カウントと
// アカウントロックは session 無し = sign-in 経路でのみ動き、プラグインの rate limit も
// /two-factor/* path 限定)。誤コード連投の抑止はこの use-case の外 — handler 側の
// createRateLimitMiddleware が担う。
export async function disable(params: {
  actor: Actor;
  headers: Headers;
  code: string;
  kind: MfaCodeKind;
}): Promise<DisableResult> {
  const { actor, headers, code, kind } = params;

  const verified = await verifyMfaCode(headers, { code, kind });
  if (!verified.ok) return verified;

  const revoked = await revokeOtherSessions(headers);
  if (!revoked.ok) return revoked;

  const disabled = await disableTotp(headers);
  if (!disabled.ok) return disabled;

  // 記帳の失敗で手続き全体を落とさないのは activate と同じ理由 — rotate 済みで巻き戻せない地点であり、
  // 例外にすると Set-Cookie が転送されず本人が今のデバイスからログアウトし、通知メールも消える。
  const { ip, userAgent } = getClientContext(headers);
  await recordMfaDisabled({ user_id: actor.id, ip, userAgent }).catch((e) =>
    captureAuditLogError("mfa_disabled", e),
  );

  return {
    ok: true,
    forwardedHeaders: mergeForwardedCookies(verified.headers, revoked.headers, disabled.headers),
    notifyEmail: actor.email,
  };
}
