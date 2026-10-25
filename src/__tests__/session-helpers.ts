import { makeSignature } from "better-auth/crypto";
import { Effect } from "effect";
import { auth } from "../auth";
import { AuthApi } from "../auth-service";
import { sentLinkIn } from "../../testing/local-delivery-log";
import { TtlStore } from "../ttl-store-service";
import type { Actor } from "../account/actor-contract";
import { observing } from "./live-runner";

export const TEST_CLIENT_IP = "203.0.113.9";
export const TEST_USER_AGENT = "mfa-integration-test";

const signCookieValue = (value: string): Effect.Effect<string> =>
  Effect.promise(async () => {
    const { secret } = await auth.$context;
    return `${value}.${await makeSignature(value, secret)}`;
  });

export function tamperCookieSignature(signed: string): string {
  const separator = signed.lastIndexOf(".");
  const signature = signed.slice(separator + 1);
  const flippedHead = signature[0] === "A" ? "B" : "A";
  return `${signed.slice(0, separator)}.${flippedHead}${signature.slice(1)}`;
}

export function requestHeaders(cookies: Record<string, string> = {}): Headers {
  const headers = new Headers({
    "user-agent": TEST_USER_AGENT,
    "x-forwarded-for": TEST_CLIENT_IP,
  });
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  if (cookie) headers.set("cookie", cookie);
  return headers;
}

export const SIGNED_COOKIE_VALUE = /^[^%;]+\.[A-Za-z0-9+/]{43}=$/;

export type TestSession = { token: string; headers: Headers };

const sessionCookieName = (): Effect.Effect<string> =>
  Effect.promise(async () => (await auth.$context).authCookies.sessionToken.name);

const sessionHeaders = (token: string): Effect.Effect<Headers> =>
  Effect.gen(function* () {
    const name = yield* sessionCookieName();
    return requestHeaders({ [name]: yield* signCookieValue(token) });
  });

export const createSessionFor = (userId: string): Effect.Effect<TestSession> =>
  Effect.gen(function* () {
    const session = yield* Effect.promise(async () =>
      (await auth.$context).internalAdapter.createSession(userId),
    );
    return { token: session.token, headers: yield* sessionHeaders(session.token) };
  });

export const sessionUserIdOf = (headers: Headers) =>
  AuthApi.use((authApi) => authApi.getSession(headers)).pipe(
    Effect.map((session) => session?.user.id),
  );

export const issuedSessionCookieCount = (forwarded: Headers): Effect.Effect<number> =>
  Effect.map(issuedSessionSetCookies(forwarded), (cookies) => cookies.length);

export const issuedSessionSetCookies = (forwarded: Headers): Effect.Effect<string[]> =>
  Effect.map(sessionCookieName(), (name) =>
    forwarded
      .getSetCookie()
      .filter((cookie) => cookie.startsWith(`${name}=`) && !/max-age=0(;|$)/i.test(cookie))
      .filter((cookie) => setCookieValue(cookie).lastIndexOf(".") > 0),
  );

export const attributeSet = (setCookie: string) =>
  new Set(
    setCookie
      .split(";")
      .slice(1)
      .map((part) => part.trim())
      .map((part) => (part.startsWith("Max-Age=") ? "Max-Age" : part)),
  );

export function setCookieValue(setCookie: string): string {
  const pair = setCookie.split(";")[0];
  return pair.slice(pair.indexOf("=") + 1);
}

export function actorOf(user: { id: string; email: string }): Pick<Actor, "id" | "email"> {
  return { id: user.id, email: user.email };
}

export const countLiveSessions = (tokens: string[]) =>
  Effect.gen(function* () {
    const ttlStore = yield* TtlStore;
    const entities = yield* Effect.forEach(tokens, (token) => ttlStore.get(token), {
      concurrency: "unbounded",
    });
    return entities.filter((entity) => entity !== null).length;
  });

export const deleteSessionEntities = (tokens: string[]) =>
  Effect.gen(function* () {
    const ttlStore = yield* TtlStore;
    yield* Effect.forEach(tokens, (token) => ttlStore.delete(token), { concurrency: "unbounded" });
  });

const AUTH_ORIGIN = "http://localhost:3100";

type PrimaryAuthLogin = { response: Response; location: URL | null; logs: string[] };

const handleWithBackgroundTasks = (request: Request) =>
  observing(Effect.promise(() => auth.handler(request))).pipe(
    Effect.map(({ value, logs }) => ({ response: value, logs })),
  );

export const requestMagicLink = (input: { email: string; callbackURL: string }) =>
  Effect.gen(function* () {
    const { logs } = yield* handleWithBackgroundTasks(
      new Request(`${AUTH_ORIGIN}/api/auth/sign-in/magic-link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: input.email, callbackURL: input.callbackURL }),
      }),
    );
    const link = sentLinkIn(logs, input.email);
    if (!link) return yield* Effect.die(new Error(`no magic link was sent to ${input.email}`));
    return link;
  });

export const followMagicLink = (link: string) =>
  handleWithBackgroundTasks(
    new Request(link, {
      headers: { "user-agent": TEST_USER_AGENT, "x-forwarded-for": TEST_CLIENT_IP },
      redirect: "manual",
    }),
  ).pipe(
    Effect.map(({ response, logs }): PrimaryAuthLogin => {
      const location = response.headers.get("location");
      return { response, location: location ? new URL(location) : null, logs };
    }),
  );

export const loginWithMagicLink = (input: { email: string; callbackURL: string }) =>
  requestMagicLink(input).pipe(Effect.flatMap(followMagicLink));

export function browserCookieHeaders(response: Response): Headers {
  const pairs = response.headers
    .getSetCookie()
    .filter((cookie) => !/max-age=0(;|$)/i.test(cookie))
    .map((cookie) => cookie.split(";")[0])
    .filter((pair) => pair.slice(pair.indexOf("=") + 1) !== "");
  return requestHeaders(
    Object.fromEntries(
      pairs.map((pair) => [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)]),
    ),
  );
}
