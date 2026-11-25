import { DEV_HOME_PATH } from "@taimei-code/auth-client/testing";
import { Effect, Option, Schema } from "effect";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  addBrowserAccount,
  companyNamesByIds,
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
import {
  type Destination,
  FlagNotice,
  type PageAccount,
  type PageProps,
  type Viewer,
} from "../web/non-production/page-props";
import { decodeFormBody } from "./decode-body";
import { FEATURE_FLAG_CATALOG, type FeatureFlagCatalog } from "./feature-flag-catalog";
import type { FakeFlagship } from "./feature-flags";
import { chosenAccountOf, pageAccountOf } from "./chosen-account";
import { nonProductionShell } from "./non-production-shell";
import { magicLinkUrlFor, type NonProductionEmail } from "./sent-links";

export const DEV_HOME_SIGN_IN_PATH = `${DEV_HOME_PATH}/sign-in`;
export const DEV_HOME_SIGN_OUT_PATH = `${DEV_HOME_PATH}/sign-out`;
const DEV_HOME_FEATURE_FLAGS_PATH = `${DEV_HOME_PATH}/feature-flags`;

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
const FLAG_NOTICE_COOKIE = "dev_home_flag_notice";
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

const nonProductionPage = <E, R>(
  c: Context,
  propsOf: (
    url: URL,
    redirectTarget: Option.Option<RedirectTarget>,
  ) => Effect.Effect<PageProps, E, R>,
) =>
  Effect.gen(function* () {
    const url = new URL(c.req.url);
    const props = yield* propsOf(url, yield* redirectTargetOf(url));
    return yield* Effect.promise(async () => c.html(nonProductionShell(props)));
  }).pipe(
    Effect.catchTag("InvalidArgument", () =>
      Effect.succeed(c.redirect(INVALID_REDIRECT_URL_PAGE, 302)),
    ),
  );

const FlagNoticeFromJson = Schema.fromJsonString(FlagNotice);

const flagNoticeOf = (c: Context): FlagNotice | null =>
  Option.getOrNull(
    Schema.decodeUnknownOption(FlagNoticeFromJson)(getCookie(c, FLAG_NOTICE_COOKIE)),
  );

const noticeFlag = (c: Context, notice: FlagNotice) =>
  setCookie(
    c,
    FLAG_NOTICE_COOKIE,
    Schema.encodeSync(FlagNoticeFromJson)(notice),
    NOTICE_COOKIE_OPTIONS,
  );

const FlagSwitchForm = Schema.Struct({
  flag: Schema.String,
  state: Schema.Literals(["on", "off", "onlyFor"]),
  companyIds: Schema.optional(Schema.String),
});

const COMPANY_ID_SEPARATOR = /[\s,、]+/;

const companyIdsWritten = (written: string | undefined): readonly string[] => [
  ...new Set((written ?? "").split(COMPANY_ID_SEPARATOR).filter((id) => id !== "")),
];

const featureFlagsPage = (featureFlags: FakeFlagship, catalog: FeatureFlagCatalog) =>
  new Hono()
    .get(DEV_HOME_FEATURE_FLAGS_PATH, (c) =>
      runRoute(
        c,
        nonProductionPage(c, (url) =>
          Effect.gen(function* () {
            const flags = yield* Effect.forEach(Object.entries(catalog), ([name, audience]) =>
              Effect.promise(async () => ({
                name,
                audience,
                ...(await featureFlags.stateOf(name)),
              })),
            );
            const names = yield* Effect.promise(() =>
              companyNamesByIds(flags.flatMap(({ companyIds }) => companyIds)),
            );
            const notice = flagNoticeOf(c);
            deleteCookie(c, FLAG_NOTICE_COOKIE, NOTICE_COOKIE_OPTIONS);
            return {
              _tag: "FeatureFlags",
              storedIn: featureFlags.storedIn,
              homeHref: `${DEV_HOME_PATH}${url.search}`,
              switchAction: `${DEV_HOME_FEATURE_FLAGS_PATH}${url.search}`,
              notice,
              flags: flags.map(({ name, audience, status, companyIds }) => ({
                name,
                audience,
                status,
                companies: companyIds.map((id) => ({ id, name: names.get(id) ?? null })),
              })),
            } as const;
          }),
        ),
      ),
    )
    .post(DEV_HOME_FEATURE_FLAGS_PATH, requireAuthHostOrigin, (c) =>
      runRoute(
        c,
        Effect.gen(function* () {
          const url = new URL(c.req.url);
          yield* redirectTargetOf(url);
          const form = yield* decodeFormBody(c, FlagSwitchForm);
          const audience = Object.hasOwn(catalog, form.flag) ? catalog[form.flag] : undefined;
          if (audience === undefined) return yield* new InvalidArgument({});
          const decision = yield* flagSwitchOf(form, audience);
          if (decision._tag === "Rejected") noticeFlag(c, decision.notice);
          else {
            yield* Effect.promise(() => featureFlags.switchFlag(decision.request));
            noticeFlag(c, { _tag: "Switched", flag: form.flag, state: form.state });
          }
          return c.redirect(`${DEV_HOME_FEATURE_FLAGS_PATH}${url.search}`, 303);
        }),
      ),
    );

const flagSwitchOf = Effect.fnUntraced(function* (
  form: typeof FlagSwitchForm.Type,
  audience: FeatureFlagCatalog[string],
) {
  if (form.state !== "onlyFor")
    return { _tag: "Accepted", request: { flag: form.flag, state: form.state } } as const;
  if (audience !== "companies") return yield* new InvalidArgument({});
  const companyIds = companyIdsWritten(form.companyIds);
  if (companyIds.length === 0)
    return { _tag: "Rejected", notice: { _tag: "NoCompanyIds" } } as const;
  const names = yield* Effect.promise(() => companyNamesByIds(companyIds));
  const unknownIds = companyIds.filter((id) => !names.has(id));
  if (unknownIds.length > 0)
    return { _tag: "Rejected", notice: { _tag: "UnknownCompanyIds", ids: unknownIds } } as const;
  return { _tag: "Accepted", request: { flag: form.flag, state: form.state, companyIds } } as const;
});

const LOCAL_EXPLORER_HOST = "localhost";

const localExplorerHrefOf = (url: URL, flagshipApp: string): string => {
  const explorer = new URL(`/cdn-cgi/local/explorer/flagship/${flagshipApp}`, url);
  explorer.hostname = LOCAL_EXPLORER_HOST;
  return explorer.href;
};

const featureFlagsHrefOf = (
  url: URL,
  switchedIn: { featureFlags?: FakeFlagship; localExplorerFlagshipApp?: string },
): string | null => {
  if (switchedIn.featureFlags) return `${DEV_HOME_FEATURE_FLAGS_PATH}${url.search}`;
  if (switchedIn.localExplorerFlagshipApp)
    return localExplorerHrefOf(url, switchedIn.localExplorerFlagshipApp);
  return null;
};

export const devHomeRoutes = ({
  recordsEmailTo,
  featureFlags,
  localExplorerFlagshipApp,
  flagCatalog = FEATURE_FLAG_CATALOG,
}: Pick<NonProductionEmail, "recordsEmailTo"> & {
  featureFlags?: FakeFlagship;
  localExplorerFlagshipApp?: string;
  flagCatalog?: FeatureFlagCatalog;
}) => {
  const routes = new Hono()
    .get(DEV_HOME_PATH, (c) =>
      runRoute(
        c,
        nonProductionPage(c, (url, redirectTarget) =>
          Effect.gen(function* () {
            const browserKey = browserKeyIssuedIfMissing(c);
            const session = yield* AuthApi.use((authApi) => authApi.getSession(c.req.raw.headers));
            if (session && recordsEmailTo(session.user.email))
              yield* Effect.promise(() => addBrowserAccount(browserKey, session.user.id));
            const accounts = (yield* Effect.promise(() => listChoosableAccounts(browserKey))).map(
              pageAccountOf,
            );
            const signedIn = accounts.find((account) => account.id === session?.user.id);
            const viewer = viewerOf(c, signedIn);
            deleteCookie(c, CHOSEN_USER_COOKIE, NOTICE_COOKIE_OPTIONS);
            deleteCookie(c, SIGNED_OUT_COOKIE, NOTICE_COOKIE_OPTIONS);
            return {
              _tag: "DevHome",
              devAccounts: accounts.filter(({ id }) => DEV_ACCOUNT_IDS.includes(id)),
              browserAccounts: accounts.filter(({ id }) => !DEV_ACCOUNT_IDS.includes(id)),
              viewer,
              destination: destinationOf(redirectTarget),
              signInAction: `${DEV_HOME_SIGN_IN_PATH}${url.search}`,
              signOutAction: `${DEV_HOME_SIGN_OUT_PATH}${url.search}`,
              featureFlagsHref: featureFlagsHrefOf(url, { featureFlags, localExplorerFlagshipApp }),
            } as const;
          }),
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
  return featureFlags ? routes.route("/", featureFlagsPage(featureFlags, flagCatalog)) : routes;
};
