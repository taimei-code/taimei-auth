import { DEV_HOME_PATH } from "@taimei-code/auth-client/testing";
import { Effect, Option } from "effect";
import { Hono } from "hono";
import { html } from "hono/html";
import { listAccounts } from "../db/testing/dev-accounts";
import { UserRepo } from "../src/account/ports";
import { AuthApi } from "../src/auth-service";
import { InvalidArgument, NotFound } from "../src/failures";
import { runRoute } from "../src/handlers/run-route";
import {
  INVALID_REDIRECT_URL_PAGE,
  type RedirectTarget,
  redirectTargetSchema,
} from "../src/sign-in-params";
import { requireAuthHostOrigin } from "./auth-host-origin";
import { type Account, activeCompanyItemsOf, ChosenUser } from "./chosen-account";
import { decodeFormBody } from "./decode-body";
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

const signedInSection = (signedIn: Account | undefined, search: string) =>
  signedIn
    ? html`<p>${signedIn.name} (${signedIn.email})</p>
        <ul>${activeCompanyItemsOf(signedIn)}</ul>
        <form method="post" action="${DEV_HOME_SIGN_OUT_PATH}${search}">
          <button type="submit">ログアウト</button>
        </form>`
    : html`<p>ログインしていません</p>`;

const accountRow = (account: Account, signedIn: Account | undefined, search: string) => html`<li>
  <form method="post" action="${DEV_HOME_SIGN_IN_PATH}${search}">
    <input type="hidden" name="userId" value="${account.id}" />
    <button type="submit"${account.id === signedIn?.id ? html` disabled` : ""}>${account.name} (${account.email})</button>
  </form>
  <ul>${activeCompanyItemsOf(account)}</ul>
</li>`;

const returnLink = (redirectTarget: Option.Option<RedirectTarget>) =>
  Option.match(redirectTarget, {
    onNone: () => "",
    onSome: ({ redirect_url }) => html`<p><a href="${redirect_url}">アプリケーションに戻る</a></p>`,
  });

const devHomePage = (
  accounts: readonly Account[],
  signedIn: Account | undefined,
  redirectTarget: Option.Option<RedirectTarget>,
  search: string,
) => html`<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <title>開発者ホーム</title>
  </head>
  <body>
    <main>
      <h1>開発者ホーム</h1>
      <section aria-labelledby="signed-in">
        <h2 id="signed-in">ログイン中の利用者</h2>
        ${signedInSection(signedIn, search)}
      </section>
      <section aria-labelledby="accounts">
        <h2 id="accounts">利用者を選んでログイン</h2>
        <ul>${accounts.map((account) => accountRow(account, signedIn, search))}</ul>
      </section>
      ${returnLink(redirectTarget)}
      <p><a href="/account">アカウント管理画面を開く</a></p>
    </main>
  </body>
</html>`;

export const devHomeRoutes = () =>
  new Hono()
    .get(DEV_HOME_PATH, (c) =>
      runRoute(
        c,
        Effect.gen(function* () {
          const url = new URL(c.req.url);
          const redirectTarget = yield* redirectTargetOf(url);
          const [session, accounts] = yield* Effect.all(
            [
              AuthApi.use((authApi) => authApi.getSession(c.req.raw.headers)),
              Effect.promise(listAccounts),
            ],
            { concurrency: "unbounded" },
          );
          const signedIn = accounts.find((account) => account.id === session?.user.id);
          return yield* Effect.promise(async () =>
            c.html(devHomePage(accounts, signedIn, redirectTarget, url.search)),
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
          const redirectTarget = yield* redirectTargetOf(new URL(c.req.url));
          const { userId } = yield* decodeFormBody(c, ChosenUser);
          const user = yield* UserRepo.use((users) => users.findUserById(userId));
          if (!user) return yield* new NotFound();
          const callbackUrl = redirectTarget.pipe(
            Option.map(({ redirect_url }) => redirect_url),
            Option.getOrElse(() => DEV_HOME_PATH),
          );
          return c.redirect(yield* magicLinkUrlFor(user.email, callbackUrl), 303);
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
          const response = c.redirect(`${DEV_HOME_PATH}${url.search}`, 303);
          for (const cookie of clearCookieHeaders.getSetCookie()) {
            response.headers.append("set-cookie", cookie);
          }
          return response;
        }),
      ),
    );
