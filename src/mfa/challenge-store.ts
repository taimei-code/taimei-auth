import { generateRandomString } from "better-auth/crypto";
import { getAuthContext } from "./gateway";

// better-auth twoFactor プラグインのチャレンジ状態を、プラグイン自身と同じ内部形式で
// 読み書きする。**この結合は意図的**で、プラグインの after-hook が magic link / OAuth 経路に
// match しない (1.6.4 で upstream が意図的に縮小) ため、チャレンジの発行だけを自前で行い
// 検証はプラグイン本体に通す、というハイブリッド構成を取っているのが理由。
//
// 内部形式への結合はこの 1 ファイルに封じる。cookie 名 / 署名 scheme / verification key 形式 /
// maxAge を src/mfa/ の他ファイルや src/auth-plugins/ に漏らさないこと。封じ込めは
// 静的 tripwire (`two_factor` / `2fa-` リテラルの出現箇所) と、challenge-store が作った状態を
// gateway の verify が消費できることを見る統合 tripwire が固定する。
//
// 撤退線: upstream がチャレンジ範囲の再拡大 (per-method opt-out) を出したら本ファイルと
// プラグイン登録だけを捨てて標準構成へ移行する。
// 設計詳細: docs/adr/0013-mfa-totp-challenge.md

// 出典: node_modules/better-auth/dist/plugins/two-factor/constant.mjs (better-auth 1.6.23)。
// 公開 subpath から re-export されていないためハードコピーしている。実際の cookie 名は
// createAuthCookie が prefix (`better-auth.` / `__Secure-`) を付けた後の値。
const TWO_FACTOR_COOKIE_NAME = "two_factor";

// cookie の maxAge と verification value の TTL を同じ値にすることで、cookie は生きているのに
// 状態だけ消えている (またはその逆) の中途半端な期限切れを作らない。
const CHALLENGE_TTL_SECONDS = 600;

const CHALLENGE_METHODS = ["magic_link", "github"] as const;

// チャレンジ通過後に発火する sign_in audit の method。payload の union と一致させる。
export type ChallengeMethod = (typeof CHALLENGE_METHODS)[number];

export type ChallengeState =
  | { pending: false }
  | { pending: true; redirectUrl: string | undefined; method: ChallengeMethod | undefined };

type AuthContext = Awaited<ReturnType<typeof getAuthContext>>;

// issueChallenge が better-auth の hook ctx から使う機能だけを構造的に宣言する。
// 具体型を import しないのは GenericEndpointContext が公開 export に無いため。
type ChallengeIssuingContext = {
  context: {
    secret: string;
    createAuthCookie(
      name: string,
      overrides?: ChallengeCookieOverrides,
    ): { name: string; attributes: unknown };
    internalAdapter: {
      createVerificationValue(data: {
        value: string;
        identifier: string;
        expiresAt: Date;
      }): Promise<unknown>;
    };
  };
  setSignedCookie(name: string, value: string, secret: string, options?: unknown): Promise<unknown>;
};

type ChallengeCookieAttributes = {
  path?: string;
  domain?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: string | boolean;
};

const newChallengeId = (): string => `2fa-${generateRandomString(20)}`;
const attemptsKey = (challengeId: string): string => `2fa-attempts-${challengeId}`;
const detailKey = (challengeId: string): string => `mfa-detail-${challengeId}`;

type ChallengeDetail = { redirectUrl: string; method: ChallengeMethod };

type ChallengeCookieOverrides = { maxAge?: number; domain?: string | undefined };

// チャレンジ画面も API も auth ホストに閉じ、consumer app へ渡るのは通過後のセッション cookie
// だけ。crossSubDomainCookies が全 auth cookie に付ける Domain を打ち消して host-only にし、
// 第二要素の材料を全 subdomain へ配らない (プラグインの読み出しは cookie 名だけなので無影響)。
const HOST_ONLY_CHALLENGE_COOKIE: ChallengeCookieOverrides = {
  maxAge: CHALLENGE_TTL_SECONDS,
  domain: undefined,
};

// 本番の secondaryStorage は Upstash REST (1 write = 1 HTTP、リトライ無し) で、write は
// 非トランザクショナル。書き込み順を「補助キー → attempts → 最後に完了マーカー」に固定し、
// マーカー (challengeId 自体をキーとする値) の存在をチャレンジ成立の単一判定にすることで、
// 途中で失敗しても「未成立」に縮退させる (部分成立でユーザーが座礁しない)。
//
// 遷移先と一次認証手段は 1 本の JSON に畳んで write を 3 本に抑える。マーカーへ相乗りさせて
// 2 本にはできない — その value をプラグインが userId そのものとして findUserById /
// createSession に渡し `consumed.value !== user.id` で突き合わせるため
// (better-auth 1.6.23 dist/plugins/two-factor/verify-two-factor.mjs)。attempts も同様に必須。
export async function issueChallenge(
  ctx: ChallengeIssuingContext,
  challenge: { userId: string; redirectUrl: string; method: ChallengeMethod },
): Promise<void> {
  const challengeId = newChallengeId();
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000);
  const { internalAdapter, secret, createAuthCookie } = ctx.context;
  const detail: ChallengeDetail = {
    redirectUrl: challenge.redirectUrl,
    method: challenge.method,
  };

  await internalAdapter.createVerificationValue({
    value: JSON.stringify(detail),
    identifier: detailKey(challengeId),
    expiresAt,
  });
  await internalAdapter.createVerificationValue({
    value: "0",
    identifier: attemptsKey(challengeId),
    expiresAt,
  });
  await internalAdapter.createVerificationValue({
    value: challenge.userId,
    identifier: challengeId,
    expiresAt,
  });

  const cookie = createAuthCookie(TWO_FACTOR_COOKIE_NAME, HOST_ONLY_CHALLENGE_COOKIE);
  await ctx.setSignedCookie(cookie.name, challengeId, secret, cookie.attributes);
}

// 成立中のチャレンジへのハンドル。userId / email を絶対に持たせないこと — 読み出し結果は
// 未認証のブラウザに露出する (GET /api/mfa/challenge は requireActor を通らない)。
export type OpenChallenge = {
  redirectUrl: string | undefined;
  method: ChallengeMethod | undefined;
  consume(): Promise<Headers>;
};

// cookie の署名検証は crypto.subtle を 2 回 (importKey + verify) 叩き、通過経路は読み出しと
// 後始末の両方を必ず通る。解決結果をハンドルに載せて共有し、1 リクエストで 1 度だけ払う。
export async function openChallenge(headers: Headers): Promise<OpenChallenge | null> {
  const authContext = await getAuthContext();
  const challengeId = await resolveChallengeId(headers, authContext);
  if (!challengeId) return null;

  const marker = await authContext.internalAdapter.findVerificationValue(challengeId);
  if (!isUnexpired(marker)) return null;

  const detail = parseDetail(await readValue(authContext, detailKey(challengeId)));
  return {
    redirectUrl: detail?.redirectUrl,
    method: detail?.method,
    consume: () => consumeResolved(authContext, challengeId),
  };
}

export async function readChallenge(headers: Headers): Promise<ChallengeState> {
  const open = await openChallenge(headers);
  if (!open) return { pending: false };
  return { pending: true, redirectUrl: open.redirectUrl, method: open.method };
}

// 一次認証手段だけを引く。完了マーカーの生存を要求しないのは、チャレンジ成功を観測する
// sign-in-observer が「プラグインがマーカーを消費した後」に走るため。
export async function readChallengeMethod(headers: Headers): Promise<ChallengeMethod | undefined> {
  const authContext = await getAuthContext();
  const challengeId = await resolveChallengeId(headers, authContext);
  if (!challengeId) return undefined;
  return parseDetail(await readValue(authContext, detailKey(challengeId)))?.method;
}

// 検証成功後の後始末。完了マーカーと attempts はプラグインが消費するが、補助キーは
// 誰も消さないため自前で消す。返す Headers の Set-Cookie は handler が転送する。
async function consumeResolved(authContext: AuthContext, challengeId: string): Promise<Headers> {
  await authContext.internalAdapter.deleteVerificationByIdentifier(detailKey(challengeId));
  const cookie = authContext.createAuthCookie(TWO_FACTOR_COOKIE_NAME, HOST_ONLY_CHALLENGE_COOKIE);
  const cleared = new Headers();
  cleared.append("set-cookie", serializeClearedCookie(cookie.name, cookie.attributes));
  return cleared;
}

// 詳細が壊れていても (旧形式の残留・発行途中の失敗) チャレンジ自体の成立は取り消さない。
// 成立判定はマーカー 1 本が持ち、読めない遷移先は redirect-guard が既定に倒す。
function parseDetail(raw: string | undefined): ChallengeDetail | undefined {
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const { redirectUrl, method } = parsed as Record<string, unknown>;
  if (typeof redirectUrl !== "string") return undefined;
  const known = CHALLENGE_METHODS.find((candidate) => candidate === method);
  return known ? { redirectUrl, method: known } : undefined;
}

// チャレンジ検証へ渡す前にセッション cookie を落とし、「一次認証は済んだがセッションはまだ無い」
// 状態をヘッダで表明する。プラグインは session を解決できたかどうかで挙動を切り替えており、
// セッションが解決できると **試行カウント (5 回でチャレンジ破棄) もアカウントロック (10 回で
// 15 分) も丸ごと skip され、チャレンジを消費しないまま成功扱いになる**。stale なセッション
// cookie が 1 本残っているだけで第二要素の総当たり防御が消えるため、経路の入口で必ず通すこと。
//
// cookie 名は chunk 分割 (`.0` / `.1` 接尾) されうるので前方一致で落とす。
export async function asPreSessionHeaders(headers: Headers): Promise<Headers> {
  const cookieHeader = headers.get("cookie");
  const preSession = new Headers(headers);
  if (!cookieHeader) return preSession;

  const { authCookies } = await getAuthContext();
  const sessionCookiePrefixes = [authCookies.sessionToken.name, authCookies.sessionData.name];
  const kept = cookieHeader.split(";").filter((pair) => {
    const separator = pair.indexOf("=");
    if (separator === -1) return true;
    const name = pair.slice(0, separator).trim();
    return !sessionCookiePrefixes.some((prefix) => name.startsWith(prefix));
  });

  if (kept.length === 0) preSession.delete("cookie");
  else preSession.set("cookie", kept.join(";"));
  return preSession;
}

async function readValue(
  authContext: AuthContext,
  identifier: string,
): Promise<string | undefined> {
  const record = await authContext.internalAdapter.findVerificationValue(identifier);
  return isUnexpired(record) ? record?.value : undefined;
}

// findVerificationValue は secondaryStorage 経路で Redis の JSON をそのまま返すため
// expiresAt が string になる (DB 経路では Date)。new Date() で正規化してから比較する。
function isUnexpired(record: { expiresAt: Date | string } | null | undefined): boolean {
  if (!record) return false;
  return new Date(record.expiresAt).getTime() > Date.now();
}

async function resolveChallengeId(
  headers: Headers,
  authContext: AuthContext,
): Promise<string | null> {
  const cookie = authContext.createAuthCookie(TWO_FACTOR_COOKIE_NAME);
  const raw = readCookie(headers, cookie.name);
  if (!raw) return null;
  const separator = raw.lastIndexOf(".");
  if (separator < 1) return null;
  const challengeId = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);
  return (await hasValidSignature(challengeId, signature, authContext.secret)) ? challengeId : null;
}

function readCookie(headers: Headers, name: string): string | null {
  const header = headers.get("cookie");
  if (!header) return null;
  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator === -1 || pair.slice(0, separator).trim() !== name) continue;
    const value = pair.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

// 出典: better-call 1.3.7 の dist/crypto.mjs (makeSignature) と dist/context.mjs
// (getSignedCookie)。better-auth の署名付き cookie は better-call の scheme で、HMAC-SHA-256 を
// **パディング付き標準 base64** で載せる。better-auth 自身が trust device token 等に使う
// createHMAC("SHA-256", "base64urlnopad") とは非互換で、それで検証すると常に false になる。
// hono の getSignedCookie は同一 scheme で署名としては互換だが、Hono の Context を要求するため
// 生の Headers を扱う本経路には載らない (詳細: docs/adr/0013-mfa-totp-challenge.md)。
const COOKIE_SIGNATURE_ALGORITHM = { name: "HMAC", hash: "SHA-256" } as const;

// 署名の形 (標準 base64 の 32 byte = 44 文字、末尾 "=") を先に見るのは better-call と同じ順序。
// 値の分割位置を誤った文字列で subtle.verify を呼ばないための足切り。
async function hasValidSignature(
  signedValue: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  if (signature.length !== 44 || !signature.endsWith("=")) return false;
  let decoded: string;
  try {
    decoded = atob(signature);
  } catch {
    return false;
  }
  const signatureBytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) signatureBytes[i] = decoded.charCodeAt(i);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    COOKIE_SIGNATURE_ALGORITHM,
    false,
    ["verify"],
  );
  return crypto.subtle
    .verify(COOKIE_SIGNATURE_ALGORITHM, key, signatureBytes, new TextEncoder().encode(signedValue))
    .catch(() => false);
}

function serializeClearedCookie(name: string, attributes: ChallengeCookieAttributes): string {
  const parts = [`${name}=`, "Max-Age=0", `Path=${attributes.path ?? "/"}`];
  if (attributes.domain) parts.push(`Domain=${attributes.domain}`);
  if (attributes.httpOnly) parts.push("HttpOnly");
  if (attributes.secure) parts.push("Secure");
  if (typeof attributes.sameSite === "string") {
    parts.push(`SameSite=${attributes.sameSite[0].toUpperCase()}${attributes.sameSite.slice(1)}`);
  }
  return parts.join("; ");
}
