import { TESTING_PATH } from "@taimei-code/auth-client/testing";
import { Effect, Schema } from "effect";
import { Hono } from "hono";
import { html } from "hono/html";
import { listAccounts } from "../db/testing/dev-accounts";
import { UserRepo } from "../src/account/ports";
import { AuthApi } from "../src/auth-service";
import { NotFound } from "../src/failures";
import { runRoute } from "../src/handlers/run-route";
import { decodeBody } from "./decode-body";
import { magicLinkUrlFor } from "./sent-links";

export const DEV_HOME_PATH = `${TESTING_PATH}/dev-home`;
export const DEV_HOME_SIGN_IN_PATH = `${DEV_HOME_PATH}/sign-in`;
export const DEV_HOME_SIGN_OUT_PATH = `${DEV_HOME_PATH}/sign-out`;

const SelectedUser = Schema.Struct({ userId: Schema.String });

type Account = Awaited<ReturnType<typeof listAccounts>>[number];

const companiesOf = (account: Account) =>
  account.memberships
    .filter(({ company }) => company.activationStatus === "ACTIVE")
    .map(({ company, role }) => html`<li>${company.name}: ${role}</li>`);

const signedInSection = (signedIn: Account | undefined) =>
  signedIn
    ? html`<p>${signedIn.name} (${signedIn.email})</p>
        <ul>${companiesOf(signedIn)}</ul>
        <form method="post" action="${DEV_HOME_SIGN_OUT_PATH}">
          <button type="submit">ログアウト</button>
        </form>`
    : html`<p>ログインしていません</p>`;

const accountRow = (account: Account, signedIn: Account | undefined) => html`<li>
  <form method="post" action="${DEV_HOME_SIGN_IN_PATH}">
    <input type="hidden" name="userId" value="${account.id}" />
    <button type="submit"${account.id === signedIn?.id ? html` disabled` : ""}>${account.name} (${account.email})</button>
  </form>
  <ul>${companiesOf(account)}</ul>
</li>`;

const devHomePage = (
  accounts: readonly Account[],
  signedIn: Account | undefined,
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
        ${signedInSection(signedIn)}
      </section>
      <section aria-labelledby="accounts">
        <h2 id="accounts">利用者を選んでログイン</h2>
        <ul>${accounts.map((account) => accountRow(account, signedIn))}</ul>
      </section>
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
          const [session, accounts] = yield* Effect.all(
            [
              AuthApi.use((authApi) => authApi.getSession(c.req.raw.headers)),
              Effect.promise(listAccounts),
            ],
            { concurrency: "unbounded" },
          );
          const signedIn = accounts.find((account) => account.id === session?.user.id);
          return yield* Effect.promise(async () => c.html(devHomePage(accounts, signedIn)));
        }),
      ),
    )
    .post(DEV_HOME_SIGN_IN_PATH, (c) =>
      runRoute(
        c,
        Effect.gen(function* () {
          const { userId } = yield* decodeBody(() => c.req.parseBody(), SelectedUser);
          const user = yield* UserRepo.use((users) => users.findUserById(userId));
          if (!user) return yield* new NotFound();
          return c.redirect(yield* magicLinkUrlFor(user.email, DEV_HOME_PATH), 303);
        }),
      ),
    )
    .post(DEV_HOME_SIGN_OUT_PATH, (c) =>
      runRoute(
        c,
        Effect.gen(function* () {
          const clearing = yield* AuthApi.use((authApi) => authApi.signOut(c.req.raw.headers));
          const response = c.redirect(DEV_HOME_PATH, 303);
          for (const cookie of clearing.getSetCookie()) {
            response.headers.append("set-cookie", cookie);
          }
          return response;
        }),
      ),
    );
