import { Effect, Schema } from "effect";
import { Hono } from "hono";
import { html } from "hono/html";
import { DEV_ACCOUNTS, listAccounts } from "../db/testing/dev-accounts";
import { UserRepo } from "../src/account/ports";
import { AuthApi } from "../src/auth-service";
import { InvalidArgument, NotFound } from "../src/failures";
import { runRoute } from "../src/handlers/run-route";
import { redirectTargetSchema } from "../src/sign-in-params";
import { decodeBody } from "./decode-body";
import { magicLinkUrlFor } from "./sent-links";

const DEV_HOME_PATH = "/dev";
export const DEV_SIGN_IN_PATH = "/dev/sign-in";
const DEV_SIGN_OUT_PATH = `${DEV_HOME_PATH}/sign-out`;

const INVALID_REDIRECT_URL_PAGE = "/auth/error?reason=invalid_redirect_url";

const SelectedUser = Schema.Struct({ userId: Schema.String });

type ReturnTarget =
  | { readonly _tag: "None" }
  | { readonly _tag: "Target"; readonly redirectUrl: string }
  | { readonly _tag: "Invalid" };

const returnTargetOf = (url: URL): ReturnTarget => {
  const query = Object.fromEntries(url.searchParams);
  if (query.service_name === undefined && query.redirect_url === undefined) return { _tag: "None" };
  const parsed = redirectTargetSchema.safeParse(query);
  return parsed.success
    ? { _tag: "Target", redirectUrl: parsed.data.redirect_url }
    : { _tag: "Invalid" };
};

type Account = Awaited<ReturnType<typeof listAccounts>>[number];

type ShownReturnTarget = Exclude<ReturnTarget, { _tag: "Invalid" }>;

const DEV_ACCOUNT_IDS = new Set(DEV_ACCOUNTS.users.map((devUser) => devUser.id));

const isDevAccount = (account: Account) => DEV_ACCOUNT_IDS.has(account.id);

const signedInUserSection = (signedIn: Account | undefined) => {
  if (!signedIn) return html`<p>ログインしていません</p>`;
  const companies = signedIn.memberships
    .filter(({ company }) => company.activationStatus === "ACTIVE")
    .map(
      ({ company, role }) =>
        html`<li>${company.name}: ${role}${company.id === signedIn.lastUsedCompanyId ? " (現在の事業所)" : ""}</li>`,
    );
  return html`<p>${signedIn.name}</p>
    <p>${signedIn.email}</p>
    <ul>${companies}</ul>`;
};

const accountOption = (account: Account, signedIn: Account | undefined, search: string) =>
  html`<option value="${account.id}" data-action="${DEV_SIGN_IN_PATH}${search}"${account.id === signedIn?.id ? html` selected` : ""}>${account.email}</option>`;

const userSelectForm = (
  accounts: readonly Account[],
  signedIn: Account | undefined,
  search: string,
) => {
  const optionsOf = (group: readonly Account[]) =>
    group.map((account) => accountOption(account, signedIn, search));
  const devAccounts = accounts.filter(isDevAccount);
  const usersCreatedInTests = accounts.filter((account) => !isDevAccount(account));
  return html`<form method="post">
    <label for="account">ログインする利用者</label>
    <select id="account" name="userId" onchange="this.form.action = this.selectedOptions[0].dataset.action; this.form.submit()">
      ${signedIn ? "" : html`<option value="" selected disabled>利用者を選ぶ</option>`}
      <optgroup label="開発用アカウント">${optionsOf(devAccounts)}</optgroup>
      <optgroup label="試験で作った利用者">${optionsOf(usersCreatedInTests)}</optgroup>
      ${signedIn ? html`<optgroup label="ログアウト"><option value="" data-action="${DEV_SIGN_OUT_PATH}${search}">ログアウトする</option></optgroup>` : ""}
    </select>
  </form>`;
};

const returnLink = (target: ShownReturnTarget) =>
  target._tag === "Target"
    ? html`<a href="${target.redirectUrl}">アプリケーションに戻る</a>`
    : html`<a href="/account">アカウント管理画面を開く</a>`;

const devHomePage = (
  accounts: readonly Account[],
  signedIn: Account | undefined,
  target: ShownReturnTarget,
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
      ${signedInUserSection(signedIn)}
      ${userSelectForm(accounts, signedIn, search)}
      <p>${returnLink(target)}</p>
    </main>
  </body>
</html>`;

const devHomeCallbackURLForBetterAuthExtraDecode = (url: URL) => {
  const query = url.searchParams.toString();
  return query ? `${DEV_HOME_PATH}?${encodeURIComponent(query)}` : DEV_HOME_PATH;
};

const rejectInvalidReturnTarget = (url: URL) =>
  returnTargetOf(url)._tag === "Invalid" ? new InvalidArgument({}) : Effect.void;

export const devHomeRoutes = () =>
  new Hono()
    .get(DEV_HOME_PATH, async (c) => {
      const url = new URL(c.req.url);
      const target = returnTargetOf(url);
      if (target._tag === "Invalid") return c.redirect(INVALID_REDIRECT_URL_PAGE, 302);
      return runRoute(
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
          return yield* Effect.promise(async () =>
            c.html(devHomePage(accounts, signedIn, target, url.search)),
          );
        }),
      );
    })
    .post(DEV_SIGN_IN_PATH, (c) => {
      const url = new URL(c.req.url);
      return runRoute(
        c,
        Effect.gen(function* () {
          yield* rejectInvalidReturnTarget(url);
          const { userId } = yield* decodeBody(() => c.req.parseBody(), SelectedUser);
          const user = yield* UserRepo.use((users) => users.findUserById(userId));
          if (!user) return yield* new NotFound();
          return c.redirect(
            yield* magicLinkUrlFor(user.email, devHomeCallbackURLForBetterAuthExtraDecode(url)),
            303,
          );
        }),
      );
    })
    .post(DEV_SIGN_OUT_PATH, (c) => {
      const url = new URL(c.req.url);
      return runRoute(
        c,
        Effect.gen(function* () {
          yield* rejectInvalidReturnTarget(url);
          const cleared = yield* AuthApi.use((authApi) => authApi.signOut(c.req.raw.headers));
          const response = c.redirect(`${DEV_HOME_PATH}${url.search}`, 303);
          for (const cookie of cleared.getSetCookie())
            response.headers.append("set-cookie", cookie);
          return response;
        }),
      );
    });
