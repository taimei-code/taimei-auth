import { DEV_HOME_PATH } from "@taimei-code/auth-client/testing";
import { Effect, Option } from "effect";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  addBrowserAccount,
  DEV_ACCOUNT_IDS,
  listChoosableAccounts,
} from "../db/testing/dev-accounts";
import { AuthApi } from "../src/auth-service";
import { InvalidArgument } from "../src/failures";
import { runRoute } from "../src/handlers/run-route";
import {
  INVALID_REDIRECT_URL_PAGE,
  type RedirectTarget,
  redirectTargetSchema,
} from "../src/sign-in-params";
import { requireAuthHostOrigin } from "./auth-host-origin";
import { browserKeyIssuedIfMissing } from "./browser-key";
import type { Destination, PageAccount, Viewer } from "../web/non-production/page-props";
import { chosenAccountOf, pageAccountOf } from "./chosen-account";
import { nonProductionShell } from "./non-production-shell";
import { magicLinkUrlFor } from "./sent-links";

export const DEV_HOME_SIGN_IN_PATH = `${DEV_HOME_PATH}/sign-in`;
export const DEV_HOME_SIGN_OUT_PATH = `${DEV_HOME_PATH}/sign-out`;

const redirectTargetOf = (
  url: URL,
): Effect.Effect<Option.Option<RedirectTarget>, InvalidArgument> => {
  const query = Object.fromEntries(url.searchParams);
  if (query.service_name === undefined && query.redirect_url === undefined)
    return Effect.succeedNone;
  const parsed = redirectTargetSchema.safeParse(query);
  return parsed.success ? Effect.succeedSome(parsed.data) : Effect.fail(new InvalidArgument({}));
};

const devHomeCallbackURLOf = (url: URL) => {
  const query = new URLSearchParams(url.search).toString();
  return query === "" ? DEV_HOME_PATH : `${DEV_HOME_PATH}?${query}`;
};

const CHOSEN_USER_COOKIE = "dev_home_chosen_user";
const SIGNED_OUT_COOKIE = "dev_home_signed_out";
const NOTICE_COOKIE_OPTIONS = {
  path: DEV_HOME_PATH,
  httpOnly: true,
  sameSite: "Lax",
  maxAge: 300,
} as const;

const destinationOf = (redirectTarget: Option.Option<RedirectTarget>): Destination =>
  Option.match(redirectTarget, {
    onNone: () => ({ _tag: "AccountPage" }),
    onSome: ({ redirect_url }) => ({ _tag: "Application", redirectUrl: redirect_url }),
  });

const viewerOf = (c: Context, signedIn: PageAccount | undefined): Viewer =>
  signedIn
    ? {
        _tag: "SignedIn",
        account: signedIn,
        notice: getCookie(c, CHOSEN_USER_COOKIE) === signedIn.id ? "JustSignedIn" : "None",
      }
    : {
        _tag: "SignedOut",
        notice: getCookie(c, SIGNED_OUT_COOKIE) === undefined ? "None" : "JustSignedOut",
      };

export const devHomeRoutes = () =>
  new Hono()
    .get(DEV_HOME_PATH, (c) =>
      runRoute(
        c,
        Effect.gen(function* () {
          const url = new URL(c.req.url);
          const redirectTarget = yield* redirectTargetOf(url);
          const browserKey = browserKeyIssuedIfMissing(c);
          const session = yield* AuthApi.use((authApi) => authApi.getSession(c.req.raw.headers));
          if (session) yield* Effect.promise(() => addBrowserAccount(browserKey, session.user.id));
          const accounts = (yield* Effect.promise(() => listChoosableAccounts(browserKey))).map(
            pageAccountOf,
          );
          const signedIn = accounts.find((account) => account.id === session?.user.id);
          const viewer = viewerOf(c, signedIn);
          deleteCookie(c, CHOSEN_USER_COOKIE, NOTICE_COOKIE_OPTIONS);
          deleteCookie(c, SIGNED_OUT_COOKIE, NOTICE_COOKIE_OPTIONS);
          return yield* Effect.promise(async () =>
            c.html(
              nonProductionShell({
                _tag: "DevHome",
                devAccounts: accounts.filter(({ id }) => DEV_ACCOUNT_IDS.includes(id)),
                browserAccounts: accounts.filter(({ id }) => !DEV_ACCOUNT_IDS.includes(id)),
                viewer,
                destination: destinationOf(redirectTarget),
                signInAction: `${DEV_HOME_SIGN_IN_PATH}${url.search}`,
                signOutAction: `${DEV_HOME_SIGN_OUT_PATH}${url.search}`,
              }),
            ),
          );
        }).pipe(
          Effect.catchTag("InvalidArgument", () =>
            Effect.succeed(c.redirect(INVALID_REDIRECT_URL_PAGE, 302)),
          ),
        ),
      ),
    )
    .post(DEV_HOME_SIGN_IN_PATH, requireAuthHostOrigin, (c) =>
      runRoute(
        c,
        Effect.gen(function* () {
          const url = new URL(c.req.url);
          yield* redirectTargetOf(url);
          const user = yield* chosenAccountOf(c);
          const magicLinkUrl = yield* magicLinkUrlFor(user.email, devHomeCallbackURLOf(url));
          setCookie(c, CHOSEN_USER_COOKIE, user.id, NOTICE_COOKIE_OPTIONS);
          return c.redirect(magicLinkUrl, 303);
        }),
      ),
    )
    .post(DEV_HOME_SIGN_OUT_PATH, requireAuthHostOrigin, (c) =>
      runRoute(
        c,
        Effect.gen(function* () {
          const url = new URL(c.req.url);
          yield* redirectTargetOf(url);
          const clearCookieHeaders = yield* AuthApi.use((authApi) =>
            authApi.signOut(c.req.raw.headers),
          );
          for (const cookie of clearCookieHeaders.getSetCookie()) {
            c.header("set-cookie", cookie, { append: true });
          }
          setCookie(c, SIGNED_OUT_COOKIE, "1", NOTICE_COOKIE_OPTIONS);
          return c.redirect(`${DEV_HOME_PATH}${url.search}`, 303);
        }),
      ),
    );
