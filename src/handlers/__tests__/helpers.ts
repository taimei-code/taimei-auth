import { Effect, Layer } from "effect";
import { Hono, type MiddlewareHandler } from "hono";
import { mountSpaApi } from "../spa-http-api";
import { AuthApi } from "../../auth-service";
import { authApiWith } from "../../__tests__/test-layers";
import type { AppServices } from "../../runtime";
import { runtimeServices } from "../spa-http-api";

export const TEST_PREFIX = "mig-test-";

export type StubActor = { id: string; email: string } | null;

type Session = NonNullable<Effect.Success<ReturnType<AuthApi["Service"]["getSession"]>>>;

export const SESSION_COOKIE_HEADER = { cookie: "__Secure-better-auth.session_token=stub-session" };

export const stubAuthApi = (
  actor: StubActor,
  overrides: Partial<AuthApi["Service"]> = {},
): Layer.Layer<AuthApi> =>
  authApiWith(() => ({
    getSession: () =>
      Effect.succeed(
        actor &&
          ({
            session: { userId: actor.id },
            user: { id: actor.id, email: actor.email },
          } as unknown as Session),
      ),
    ...overrides,
  }));

export const provideAuthApi =
  (layer: Layer.Layer<AuthApi>): MiddlewareHandler =>
  (c, next) => {
    c.set("authApiLayer", layer);
    return next();
  };

export function buildAppWith<A extends AppServices>(overrides: Layer.Layer<A>): Hono {
  const app = new Hono();
  mountSpaApi(app, Layer.merge(runtimeServices(), overrides));
  return app;
}

export const buildTestApp = (actor: StubActor, overrides?: Partial<AuthApi["Service"]>): Hono =>
  buildAppWith(stubAuthApi(actor, overrides));

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
