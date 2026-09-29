import { Effect, Layer } from "effect";
import { Hono, type MiddlewareHandler } from "hono";
import { mountAccountRoutes } from "../../app";
import { AuthApi } from "../../auth-service";
import { authApiLive } from "../../auth-wiring";

export const TEST_PREFIX = "mig-test-";

export type StubActor = { id: string; email: string } | null;

type Session = NonNullable<Effect.Success<ReturnType<AuthApi["Service"]["getSession"]>>>;

// auth-entry-redirect は getSession の前に getSessionCookie(headers) を通るため、session の分岐を検証するテストはこの header を付ける。
export const SESSION_COOKIE_HEADER = { cookie: "better-auth.session_token=stub-session" };

export const stubAuthApi = (
  actor: StubActor,
  overrides: Partial<AuthApi["Service"]> = {},
): Layer.Layer<AuthApi> =>
  Layer.succeed(
    AuthApi,
    AuthApi.of({
      ...authApiLive,
      getSession: () =>
        Effect.succeed(
          actor && ({ user: { id: actor.id, email: actor.email } } as unknown as Session),
        ),
      ...overrides,
    }),
  );

export const provideAuthApi =
  (layer: Layer.Layer<AuthApi>): MiddlewareHandler =>
  (c, next) => {
    c.set("authApiLayer", layer);
    return next();
  };

export function buildTestApp(actor: StubActor, overrides?: Partial<AuthApi["Service"]>): Hono {
  const app = new Hono();
  app.use("*", provideAuthApi(stubAuthApi(actor, overrides)));
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
