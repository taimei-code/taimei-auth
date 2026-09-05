import { Effect } from "effect";
import { Hono } from "hono";
import { mountAccountRoutes } from "../../app";
import { auth } from "../../auth";

// account handler / use-case の DB 統合テストで共用する auth stub と app 組み立て。
// DB 側の seed / 観測 (事後状態の読み取り) は TestDb service (src/__tests__/test-db.ts、実体は db/testing/*) を test 本体が yield* する。
// - session 側: auth.api.getSession を monkey-patch して任意 actor に固定する (stubActor / restoreActor)
// 実 route を叩くには DB 上の membership 行と `auth.api.getSession` が返す actor の両方が必要
// (RoutingPool 経由の DB は per-request 切替、セッションは module 定数 `requireActor` の内側で解決)。

export const TEST_PREFIX = "mig-test-";

export type StubActor = { id: string; email: string } | null;

let originalGetSession: typeof auth.api.getSession | null = null;
let currentActor: StubActor = null;

// getSession を stub して guard/core.ts の requireActor が任意の actor を返すようにする。
// module ロード時に requireActor は `auth.api.getSession` の値を closure captured せず、
// call 時に auth.api.getSession を lookup する ((headers) => auth.api.getSession({ headers }))
// ため実行時に patched 版が読まれる。
export function stubActor(actor: StubActor): void {
  if (!originalGetSession) {
    originalGetSession = auth.api.getSession;
  }
  currentActor = actor;
  auth.api.getSession = (async () => {
    if (currentActor === null) return null;
    return { user: { id: currentActor.id, email: currentActor.email } };
  }) as typeof auth.api.getSession;
}

export function restoreActor(): void {
  if (originalGetSession) {
    auth.api.getSession = originalGetSession;
    originalGetSession = null;
  }
  currentActor = null;
}

// auth-entry-redirect は getSession の前段で getSessionCookie(headers) を通すため、
// stubActor だけでは cookie 不在の早期 next() に落ちて「pass-through が正解」のテストが
// 理由を問わず緑になる。session 分岐を検証するテストは必ずこの header を付与し、
// 「cookie 無し」のケースと分岐理由を分離する (cookie 名は local 環境の非 Secure 版)。
export const SESSION_COOKIE_HEADER = { cookie: "better-auth.session_token=stub-session" };

export function buildTestApp(): Hono {
  const app = new Hono();
  mountAccountRoutes(app);
  return app;
}

// Hono app への request を Effect に持ち上げる (app.request は Response | Promise<Response> を返す)。
export const requestApp = (app: Hono, url: string, init?: RequestInit) =>
  Effect.promise(() => Promise.resolve(app.request(url, init)));

export const responseJson = (res: Response) => Effect.promise(() => res.json());

export type NormalizedResponse = {
  status: number;
  contentType: string | null;
  body: unknown;
};

// レスポンスを比較可能な JSON 化する。Content-Type と status を明示的に含める
// (fixture の deep-equal 対象がこの 3 点セット)。
export async function normalizeResponse(res: Response): Promise<NormalizedResponse> {
  const contentType = res.headers.get("content-type");
  let body: unknown;
  const text = await res.text();
  if (text.length === 0) {
    body = null;
  } else if (contentType?.includes("application/json")) {
    body = JSON.parse(text);
  } else {
    body = text;
  }
  return { status: res.status, contentType, body };
}
