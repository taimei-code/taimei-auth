import { afterEach, beforeEach, type Mock, spyOn } from "bun:test";
import { Effect, Layer } from "effect";
import { Hono, type MiddlewareHandler } from "hono";
import { mountSpaApi } from "../spa-http-api";
import { auth } from "../../auth";
import { withWaitUntil } from "../../background";
import { drained, partial } from "../../__tests__/live-runner";
import { AuthApi } from "../../auth-service";
import { requestHeaders } from "../../__tests__/session-helpers";
import { authApiWith } from "../../__tests__/test-layers";
import { testKvStore } from "../../__tests__/test-ttl-store";
import { signedIn } from "../../membership/__tests__/test-layers";
import {
  savePasskey,
  signedAuthentication,
  signedRegistration,
  type Signer,
} from "../../passkey/__tests__/helpers";
import { CLIENT_IP_HEADER } from "../../client-ip";
import { EmailSender } from "../../email/ports";
import type { AppServices } from "../../runtime";
import { JSON_HEADERS } from "../client-facing-error";
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

export const defectDuringPasskeyMail: Layer.Layer<EmailSender> = Layer.succeed(
  EmailSender,
  partial<EmailSender["Service"]>({
    sendPasskeyChanged: () => Effect.die(new Error("通知メールの組み立てで例外")),
  }),
);

export const freshSessionCookie = () => ({
  cookie: `__Secure-better-auth.session_token=${crypto.randomUUID()}`,
});

export const signedLookingSessionValue = () =>
  `${crypto.randomUUID()}.c2lnbmF0dXJl+/c2lnbmF0dXJl+/c2lnbmF0dXJl=`;

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

export const restoreKvStoreAfterEach = (): void => {
  let keysBefore = new Set<string>();
  beforeEach(() => {
    keysBefore = new Set(testKvStore.keys(""));
  });
  afterEach(() => {
    for (const key of testKvStore.keys("")) {
      if (!keysBefore.has(key)) testKvStore.delete(key as Parameters<typeof testKvStore.delete>[0]);
    }
  });
};

type ResendDelivery = { readonly to: string; readonly html: string; readonly text: string };

const resendAccepts = async () => Response.json({ id: "sent" });

const resendFails = async () =>
  Response.json(
    { name: "application_error", message: "resend down", statusCode: 500 },
    { status: 500 },
  );

export const SECURITY_PAGE_URL = `${process.env.AUTH_SERVICE_URL}/account/security`;

export const resendOutbox = () => {
  const delivered: ResendDelivery[] = [];
  let reply = resendAccepts;
  let resendApi: Mock<typeof fetch> | undefined;
  const keyBefore = process.env.AUTH_RESEND_KEY;
  beforeEach(() => {
    process.env.AUTH_RESEND_KEY = "re_test";
    delivered.length = 0;
    reply = resendAccepts;
    const passThrough = globalThis.fetch;
    resendApi = spyOn(globalThis, "fetch").mockImplementation((async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = input instanceof Request ? input.url : input.toString();
      const body = init?.body;
      if (!url.endsWith("/emails") || typeof body !== "string") return passThrough(input, init);
      const response = await reply();
      if (response.ok) delivered.push(JSON.parse(body) as ResendDelivery);
      return response;
    }) as typeof fetch);
  });
  afterEach(() => {
    resendApi?.mockRestore();
    if (keyBefore === undefined) delete process.env.AUTH_RESEND_KEY;
    else process.env.AUTH_RESEND_KEY = keyBefore;
  });
  return {
    delivered,
    recipients: () => delivered.map(({ to }) => to),
    failing: () => {
      reply = resendFails;
    },
    held: () => {
      const gate = Promise.withResolvers<void>();
      reply = async () => {
        await gate.promise;
        return resendAccepts();
      };
      return gate.resolve;
    },
  };
};

export const inBackgroundScope = async <T>(request: () => Promise<T>) => {
  const pending: Promise<unknown>[] = [];
  const result = await withWaitUntil((promise) => void pending.push(promise), request);
  return { result, settled: () => Promise.allSettled(pending) };
};

export const awaitingBackground = <T>(request: () => Promise<T>): Promise<T> =>
  Effect.runPromise(drained(Effect.promise(request)));

export type Outcome = {
  readonly status: number;
  readonly body: unknown;
  readonly setCookies: string[];
};

export const outcomeOf = async (response: Response): Promise<Outcome> => ({
  status: response.status,
  body: await response.json().catch(() => null),
  setCookies: response.headers.getSetCookie(),
});

export const statusAndBody = ({ status, body }: Outcome) => ({ status, body });

export const sameOriginHeaders = (cookie: string) => ({
  ...JSON_HEADERS,
  cookie,
  "sec-fetch-site": "same-origin",
});

export const CLIENT_IP = "203.0.113.7";
export const CLIENT_USER_AGENT = "handler-test-client/1.0";
export const clientHeaders = { "user-agent": CLIENT_USER_AGENT, [CLIENT_IP_HEADER]: CLIENT_IP };

export const postJson = (app: Hono, path: string, headers: Record<string, string>, body: string) =>
  app.request(path, { method: "POST", headers, body });

export type SignedInUser = { readonly id: string; readonly email: string };

export type SignedInSession = {
  readonly user: SignedInUser;
  readonly app: Hono;
  readonly cookie: string;
};

export const signedInSession = (
  user: SignedInUser,
  { layer = Layer.empty, cookie = freshSessionCookie().cookie } = {},
): SignedInSession => ({
  user,
  app: buildAppWith(Layer.merge(signedIn(user.id, user.email), layer)),
  cookie,
});

export const listedPasskeyIds = async (session: SignedInSession): Promise<string[]> => {
  const response = await session.app.request("/api/account/passkeys", {
    headers: { ...JSON_HEADERS, cookie: session.cookie },
  });
  const body = (await response.json()) as { passkeys: Array<{ id: string }> };
  return body.passkeys.map(({ id }) => id);
};

export const challengeOf = (outcome: Outcome): string => {
  if (outcome.status !== 200) throw new Error(`options が返らなかった: ${outcome.status}`);
  return (outcome.body as { challenge: string }).challenge;
};

export const requestRegistrationOptionsWith = async (
  session: SignedInSession,
  payload: unknown,
): Promise<Outcome> =>
  outcomeOf(
    await postJson(
      session.app,
      "/api/account/passkeys/registration-options",
      sameOriginHeaders(session.cookie),
      JSON.stringify(payload),
    ),
  );

export const requestRegistrationOptions = (session: SignedInSession): Promise<Outcome> =>
  requestRegistrationOptionsWith(session, {});

export const sendMfaDisable = async (session: SignedInSession, code: string): Promise<Outcome> =>
  outcomeOf(
    await postJson(
      session.app,
      "/api/account/mfa/disable",
      sameOriginHeaders(session.cookie),
      JSON.stringify({ code, kind: "totp" }),
    ),
  );

export const readMfaStatus = async (
  session: SignedInSession,
): Promise<{ enabled: boolean; recovery_codes_remaining: number }> => {
  const response = await session.app.request("/api/account/mfa", {
    headers: { ...JSON_HEADERS, cookie: session.cookie },
  });
  return (await response.json()) as { enabled: boolean; recovery_codes_remaining: number };
};

export const sendRegistration = async (
  session: SignedInSession,
  response: unknown,
  headers: Record<string, string> = {},
): Promise<Outcome> =>
  outcomeOf(
    await postJson(
      session.app,
      "/api/account/passkeys",
      { ...sameOriginHeaders(session.cookie), ...headers },
      JSON.stringify(response),
    ),
  );

export const signedRegistrationFor = (
  challenge: string,
  overrides: {
    readonly userVerified?: boolean;
    readonly origin?: string;
    readonly aaguid?: string;
  } = {},
) =>
  signedRegistration({
    algorithm: "ES256",
    challenge,
    userVerified: overrides.userVerified ?? true,
    ...(overrides.origin === undefined ? {} : { origin: overrides.origin }),
    ...(overrides.aaguid === undefined ? {} : { aaguid: overrides.aaguid }),
  });

export type Credential = { readonly credentialId: string; readonly signer: Signer };

export const assertionBy = (
  credential: Credential,
  challenge: string,
  overrides: {
    readonly counter?: number;
    readonly userVerified?: boolean;
    readonly signer?: Signer;
  } = {},
) =>
  signedAuthentication({
    credentialId: credential.credentialId,
    signer: overrides.signer ?? credential.signer,
    challenge,
    userVerified: overrides.userVerified ?? true,
    counter: overrides.counter ?? 1,
  });

export const savedCredentialFor = (userId: string, counter = 0) => {
  const { made, signer } = signedRegistrationFor("Y2hhbGxlbmdlLWZyb20tdGhlLXNpZ24taW4tc2V0dXA");
  return savePasskey(userId, {
    credentialId: made.id,
    publicKey: made.publicKey,
    counter,
    aaguid: made.aaguid,
    transports: [],
  }).pipe(
    Effect.flatMap((saved) =>
      saved
        ? Effect.succeed({ credentialId: made.id, signer } satisfies Credential)
        : Effect.die(new Error("パスキーを保存できなかった")),
    ),
  );
};

export const unsavedCredential = (): Credential => {
  const { made, signer } = signedRegistrationFor("c2lnbi1pbi1jaGFsbGVuZ2U");
  return { credentialId: made.id, signer };
};

export const liveApp = (): Hono => {
  const app = new Hono();
  mountSpaApi(app);
  return app;
};

const anonymousHeaders = {
  ...Object.fromEntries(requestHeaders()),
  ...JSON_HEADERS,
  "sec-fetch-site": "same-origin",
};

const postAnonymously = async (app: Hono, path: string, body: unknown) =>
  outcomeOf(
    await app.request(path, {
      method: "POST",
      headers: anonymousHeaders,
      body: JSON.stringify(body),
    }),
  );

export const requestSignInOptions = (app: Hono, redirectUrl?: string): Promise<Outcome> =>
  postAnonymously(
    app,
    "/api/passkey/sign-in/options",
    redirectUrl === undefined ? {} : { redirect_url: redirectUrl },
  );

export const sendSignIn = (app: Hono, response: unknown): Promise<Outcome> =>
  postAnonymously(app, "/api/passkey/sign-in/verify", response);

export const sessionCookiesOf = ({ setCookies }: Pick<Outcome, "setCookies">) =>
  setCookies.filter((cookie) => cookie.startsWith("__Secure-better-auth.session_token="));

export const sessionUserOf = async (outcome: Outcome): Promise<string | null> => {
  const [setCookie] = sessionCookiesOf(outcome);
  if (setCookie === undefined) return null;
  const session = await auth.api.getSession({
    headers: new Headers({ cookie: setCookie.split(";", 1)[0] ?? "" }),
  });
  return session?.user.id ?? null;
};
