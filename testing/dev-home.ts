import { TESTING_PATH } from "@taimei-code/auth-client/testing";
import { Effect, Schema } from "effect";
import { Hono } from "hono";
import { html } from "hono/html";
import { listAccounts, seedDevAccounts } from "../db/testing/dev-accounts";
import { UserRepo } from "../src/account/ports";
import { AuthApi } from "../src/auth-service";
import { NotFound } from "../src/failures";
import { runRoute } from "../src/handlers/run-route";
import { decodeBody } from "./decode-body";
import { magicLinkUrlFor } from "./sent-links";

export const DEV_HOME_PATH = `${TESTING_PATH}/dev-home`;
const DEV_HOME_SIGN_IN_PATH = `${DEV_HOME_PATH}/sign-in`;
const DEV_HOME_SIGN_OUT_PATH = `${DEV_HOME_PATH}/sign-out`;

const SelectedUser = Schema.Struct({ userId: Schema.String });

type Account = Awaited<ReturnType<typeof listAccounts>>[number];

const accountRow = (account: Account, signedInId: string | undefined) => html`<li>
  <form method="post" action="${DEV_HOME_SIGN_IN_PATH}">
    <input type="hidden" name="userId" value="${account.id}" />
    <button type="submit"${account.id === signedInId ? html` disabled` : ""}>${account.name} (${account.email})</button>
  </form>
</li>`;

const devHomePage = (accounts: readonly Account[], signedIn: Account | undefined) => html`<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <title>開発者ホーム</title>
  </head>
  <body>
    <main>
      <h1>開発者ホーム</h1>
      <section aria-label="ログイン中の利用者">
        ${signedIn ? html`<p data-signed-in-user-id="${signedIn.id}">${signedIn.name} (${signedIn.email})</p>
              <form method="post" action="${DEV_HOME_SIGN_OUT_PATH}"><button type="submit">ログアウト</button></form>` : html`<p>ログインしていません</p>`}
      </section>
      <section aria-label="ログインする利用者">
        <ul>${accounts.map((account) => accountRow(account, signedIn?.id))}</ul>
      </section>
      <p><a href="/account">アカウント管理画面を開く</a></p>
    </main>
  </body>
</html>`;

export const devHomeRoutes = (options: { seedOnEveryGet: boolean }) =>
  new Hono()
    .get(DEV_HOME_PATH, (c) =>
      runRoute(
        c,
        Effect.gen(function* () {
          if (options.seedOnEveryGet) yield* Effect.promise(seedDevAccounts);
          const session = yield* AuthApi.use((authApi) => authApi.getSession(c.req.raw.headers));
          const accounts = yield* Effect.promise(listAccounts);
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
          const cleared = yield* AuthApi.use((authApi) => authApi.signOut(c.req.raw.headers));
          const response = c.redirect(DEV_HOME_PATH, 303);
          for (const cookie of cleared.getSetCookie()) response.headers.append("set-cookie", cookie);
          return response;
        }),
      ),
    );
