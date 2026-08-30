import { generateRandomString } from "better-auth/crypto";
import { getAuthContext } from "./gateway";

// better-auth twoFactor プラグインのチャレンジ状態を、プラグイン自身と同じ内部形式で読み書きする。
// **この結合は意図的** — 理由・撤退線・封じ込め構造の正本: ADR-0013 §2。
// 内部形式 (cookie 名 / 署名 scheme / verification key 形式 / maxAge) はこの 1 ファイルから漏らさないこと。

// 出典: better-auth 1.6.23 の two-factor/constant.mjs (公開 subpath に無くハードコピー)。
// 実際の cookie 名は createAuthCookie が prefix (`better-auth.` / `__Secure-`) を付けた後の値。
const TWO_FACTOR_COOKIE_NAME = "two_factor";

// cookie の maxAge と verification value の TTL を揃え、片方だけ消えた中途半端な期限切れを作らない。
const CHALLENGE_TTL_SECONDS = 600;

const CHALLENGE_METHODS = ["magic_link", "github"] as const;

// チャレンジ通過後に発火する sign_in audit の method。payload の union と一致させる。
export type ChallengeMethod = (typeof CHALLENGE_METHODS)[number];

export type ChallengeState =
  | { pending: false }
  | { pending: true; redirectUrl: string | undefined; method: ChallengeMethod | undefined };

type AuthContext = Awaited<ReturnType<typeof getAuthContext>>;

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

// crossSubDomainCookies が全 auth cookie に付ける Domain を打ち消して host-only にし、第二要素の
// 材料を全 subdomain へ配らない (プラグインの読み出しは cookie 名だけなので無影響)。
const HOST_ONLY_CHALLENGE_COOKIE: ChallengeCookieOverrides = {
  maxAge: CHALLENGE_TTL_SECONDS,
  domain: undefined,
};

// secondaryStorage の write は非トランザクショナル (Upstash REST は 1 write = 1 HTTP、リトライ無し)。
// 書き込み順を「補助キー → attempts → 最後に完了マーカー」に固定し、マーカーの存在を成立の単一判定に
// することで、途中で失敗しても「未成立」に縮退させる。
// マーカーへ相乗りして write 2 本にはできない — その value をプラグインが userId として
// findUserById / createSession に渡し突き合わせるため (1.6.23)。attempts も同様に必須。
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

// userId / email を絶対に持たせないこと — 読み出し結果は未認証のブラウザに露出する
// (GET /api/mfa/challenge は requireActor を通らない)。
export type OpenChallenge = {
  redirectUrl: string | undefined;
  method: ChallengeMethod | undefined;
  consume(): Promise<Headers>;
};

// cookie の署名検証は crypto.subtle を 2 回叩くため、解決結果をハンドルに載せて 1 リクエスト 1 度に抑える。
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

// 完了マーカーの生存を要求しないのは、sign-in-observer が「プラグインがマーカーを消費した後」に走るため。
export async function readChallengeMethod(headers: Headers): Promise<ChallengeMethod | undefined> {
  const authContext = await getAuthContext();
  const challengeId = await resolveChallengeId(headers, authContext);
  if (!challengeId) return undefined;
  return parseDetail(await readValue(authContext, detailKey(challengeId)))?.method;
}

// 完了マーカーと attempts はプラグインが消費するが、補助キーは誰も消さないため自前で消す。
async function consumeResolved(authContext: AuthContext, challengeId: string): Promise<Headers> {
  await authContext.internalAdapter.deleteVerificationByIdentifier(detailKey(challengeId));
  const cookie = authContext.createAuthCookie(TWO_FACTOR_COOKIE_NAME, HOST_ONLY_CHALLENGE_COOKIE);
  const cleared = new Headers();
  cleared.append("set-cookie", serializeClearedCookie(cookie.name, cookie.attributes));
  return cleared;
}

// 詳細が壊れていてもチャレンジの成立は取り消さない — 成立判定はマーカー 1 本が持ち、
// 読めない遷移先は redirect-guard が既定に倒す。
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

// チャレンジ検証の前にセッション cookie を落とす。セッションが解決できるとプラグインは**試行制限を
// 丸ごと skip し、チャレンジを消費しないまま成功扱いにする** — stale な cookie 1 本で第二要素の
// 総当たり防御が消えるため、経路の入口で必ず通すこと。
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

// expiresAt は経路と版で型が揺れる (Date への復元は公開契約ではない) ため new Date() で正規化する。
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

// 出典: better-call 1.3.7 (makeSignature / getSignedCookie)。HMAC-SHA-256 を**パディング付き標準
// base64** で載せる scheme — base64urlnopad 系と取り違えると常に false になる (詳細: ADR-0013 §2)。
const COOKIE_SIGNATURE_ALGORITHM = { name: "HMAC", hash: "SHA-256" } as const;

// 署名の形 (44 文字、末尾 "=") を先に見るのは better-call と同じ順序 — 分割位置を誤った文字列で
// subtle.verify を呼ばないための足切り。
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
