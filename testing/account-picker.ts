import { TESTING_PATH } from "@taimei-code/auth-client/testing";
import { Effect } from "effect";
import { type Context, Hono } from "hono";
import { html } from "hono/html";
import { listAccounts } from "../db/testing/dev-accounts";
import { UserRepo } from "../src/account/ports";
import { InvalidArgument, NotFound } from "../src/failures";
import { runRoute } from "../src/handlers/run-route";
import { INVALID_REDIRECT_URL_PAGE, signInParamsSchema } from "../src/sign-in-params";
import { type Account, activeCompanyItemsOf, ChosenUser } from "./chosen-account";
import { decodeBody } from "./decode-body";
import { magicLinkUrlFor } from "./sent-links";

const ACCOUNT_PICKER_PATH = `${TESTING_PATH}/account-picker`;

const accountRow = (account: Account, search: string) => html`<li>
  <form method="post" action="${ACCOUNT_PICKER_PATH}${search}">
    <input type="hidden" name="userId" value="${account.id}" />
    <button type="submit">${account.name} (${account.email})</button>
  </form>
  <ul>${activeCompanyItemsOf(account)}</ul>
</li>`;

const pickerPage = (accounts: readonly Account[], search: string) => html`<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <title>アカウントを選んでログイン</title>
  </head>
  <body>
    <main>
      <h1>アカウントを選んでログイン</h1>
      <ul>${accounts.map((account) => accountRow(account, search))}</ul>
      <p><a href="/auth/signup${search}">新規登録</a></p>
    </main>
  </body>
</html>`;

const signInParamsOf = (c: Context) =>
  signInParamsSchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));

export const accountPickerRoutes = () =>
  new Hono()
    .get("/auth/", async (c, next) => {
      if (c.req.query("invitation_token") !== undefined) {
        await next();
        return c.res;
      }
      if (!signInParamsOf(c).success) return c.redirect(INVALID_REDIRECT_URL_PAGE, 302);
      return runRoute(
        c,
        Effect.promise(async () =>
          c.html(pickerPage(await listAccounts(), new URL(c.req.url).search)),
        ),
      );
    })
    .post(ACCOUNT_PICKER_PATH, (c) =>
      runRoute(
        c,
        Effect.gen(function* () {
          const params = signInParamsOf(c);
          if (!params.success) return yield* new InvalidArgument({});
          const { userId } = yield* decodeBody(() => c.req.parseBody(), ChosenUser);
          const user = yield* UserRepo.use((users) => users.findUserById(userId));
          if (!user) return yield* new NotFound();
          return c.redirect(yield* magicLinkUrlFor(user.email, params.data.redirect_url), 303);
        }),
      ),
    );
