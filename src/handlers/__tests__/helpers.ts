import { Effect } from "effect";
import { Hono } from "hono";
import { mountAccountRoutes } from "../../app";
import { auth } from "../../auth";

export const TEST_PREFIX = "mig-test-";

export type StubActor = { id: string; email: string } | null;

let originalGetSession: typeof auth.api.getSession | null = null;
let currentActor: StubActor = null;

// requireActor は呼び出し時に auth.api.getSession を参照するため、差し替え後の版が読まれる。
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

// auth-entry-redirect は getSession の前に getSessionCookie(headers) を通るため、session の分岐を検証するテストはこの header を付ける。
export const SESSION_COOKIE_HEADER = { cookie: "better-auth.session_token=stub-session" };

export function buildTestApp(): Hono {
  const app = new Hono();
  mountAccountRoutes(app);
  return app;
}

export const requestApp = (app: Hono, url: string, init?: RequestInit) =>
  Effect.promise(() => Promise.resolve(app.request(url, init)));

export const responseJson = (res: Response) => Effect.promise(() => res.json());

export type NormalizedResponse = {
  status: number;
  contentType: string | null;
  body: unknown;
};

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
