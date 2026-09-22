import { Effect } from "effect";
import { Hono } from "hono";
import { mountAccountRoutes } from "../../app";
import { auth } from "../../auth";

// account handler と use-case の DB 統合テストで共用する auth stub と app の組み立て。
// DB 側の seed と観測 (事後状態の読み取り) は TestDb service (src/__tests__/test-db.ts、実体は db/testing/*) をテスト本体が yield* する。
// - session 側は auth.api.getSession を monkey-patch して任意の actor に固定する (stubActor / restoreActor)
// 実 route を呼ぶには DB 上の membership 行と `auth.api.getSession` が返す actor の両方が必要である
// (RoutingPool 経由の DB は request ごとに切り替わり、セッションは module 定数 `requireActor` の内側で解決される)。

export const TEST_PREFIX = "mig-test-";

export type StubActor = { id: string; email: string } | null;

let originalGetSession: typeof auth.api.getSession | null = null;
let currentActor: StubActor = null;

// getSession を stub して guard/core.ts の requireActor が任意の actor を返すようにする。
// requireActor は module ロード時に `auth.api.getSession` の値を closure に取り込まず、
// 呼び出し時に auth.api.getSession を参照する ((headers) => auth.api.getSession({ headers }))
// ため、実行時に差し替え後の版が読まれる。
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

// auth-entry-redirect は getSession の前に getSessionCookie(headers) を通すため、
// stubActor だけでは cookie が無いとして早期に next() へ進み、「そのまま通すのが正解」のテストが
// 理由を問わず成功してしまう。session の分岐を検証するテストは必ずこの header を付与し、
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

// レスポンスを比較できる JSON にする。Content-Type と status を明示的に含める
// (fixture の deep-equal の対象はこの 3 点である)。
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
