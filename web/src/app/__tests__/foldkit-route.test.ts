import { describe, expect, test } from "bun:test";
import { Effect, Option, pipe, Schema } from "effect";
import { Command, Route, type Update } from "foldkit";
import { defineMessageUnion } from "foldkit/message";
import { defineRouteUnion, literal, slash } from "foldkit/route";
import * as Url from "foldkit/url";

import { SERVICE_NAMES } from "@core/services";
import { validateRedirectUrl } from "@core/url-allowlist";

const DEFAULT_SIGNUP_TARGET = {
  service_name: "accounts",
  redirect_url: "http://localhost/account",
} as const;

const RedirectTarget = Schema.Struct({
  service_name: Schema.Literals(SERVICE_NAMES),
  redirect_url: Schema.String,
}).check(
  Schema.makeFilter(({ service_name, redirect_url }) =>
    validateRedirectUrl(redirect_url, service_name)
      ? undefined
      : "redirect_url is not in allowlist",
  ),
);

const AppRoute = defineRouteUnion({
  CompanySignup: { service_name: Schema.Literals(SERVICE_NAMES), redirect_url: Schema.String },
  NotFound: { path: Schema.String },
});
type AppRoute = typeof AppRoute.Type;

const companySignupRouter = pipe(
  literal("auth"),
  slash(literal("signup")),
  slash(literal("company")),
  Route.query(
    RedirectTarget.pipe(Schema.catchDecoding(() => Effect.succeedSome(DEFAULT_SIGNUP_TARGET))),
  ),
  Route.mapTo(AppRoute.CompanySignup),
);

const urlToAppRoute = Route.parseUrlWithFallback(companySignupRouter, AppRoute.NotFound);

const Message = defineMessageUnion({
  SucceededCheckSignupEntry: {},
  FailedCheckSignupEntry: {},
});

const CheckCompanySignupEntry = Command.define("CheckCompanySignupEntry", {
  args: { redirect_url: Schema.String },
  messages: [Message.SucceededCheckSignupEntry, Message.FailedCheckSignupEntry],
  execute: () => Effect.succeed(Message.SucceededCheckSignupEntry()),
});

type InitReturn = Update.Return<{ readonly route: AppRoute }, typeof Message.Type>;

const init = (route: AppRoute): InitReturn =>
  AppRoute.match<InitReturn>(route, {
    CompanySignup: ({ redirect_url }) => ({
      model: { route },
      commands: [CheckCompanySignupEntry({ redirect_url })],
    }),
    NotFound: () => ({ model: { route } }),
  });

const routeOf = (href: string): AppRoute =>
  Option.match(Url.fromString(href), {
    onNone: () => AppRoute.NotFound({ path: href }),
    onSome: urlToAppRoute,
  });

describe("TanStack Router の validateSearch と beforeLoad を Foldkit の route と init で書く", () => {
  test("検査に通る search は、そのまま route の値になる", () => {
    expect(
      routeOf(
        "http://localhost/auth/signup/company?service_name=accounts&redirect_url=http%3A%2F%2Flocalhost%2Faccount%2Fmembers",
      ),
    ).toEqual(
      AppRoute.CompanySignup({
        service_name: "accounts",
        redirect_url: "http://localhost/account/members",
      }),
    );
  });

  test("既定の値も route の検査を通るので、既定の値は許可された URL にする", () => {
    expect(() =>
      Schema.decodeUnknownSync(
        RedirectTarget.pipe(
          Schema.catchDecoding(() =>
            Effect.succeedSome({ service_name: "accounts" as const, redirect_url: "/account" }),
          ),
        ),
      )({}),
    ).toThrow("redirect_url is not in allowlist");
  });

  test("許可されていない redirect_url の search は、route の parser の中で既定の値になる", () => {
    expect(
      routeOf(
        "http://localhost/auth/signup/company?service_name=accounts&redirect_url=https%3A%2F%2Fevil.example",
      ),
    ).toEqual(AppRoute.CompanySignup(DEFAULT_SIGNUP_TARGET));
  });

  test("search が無いときも、既定の値になる", () => {
    expect(routeOf("http://localhost/auth/signup/company")).toEqual(
      AppRoute.CompanySignup(DEFAULT_SIGNUP_TARGET),
    );
  });

  test("画面を開く前の確認は、init が返す Command になる", () => {
    const { commands } = init(AppRoute.CompanySignup(DEFAULT_SIGNUP_TARGET));
    expect(commands?.map((command) => command.name)).toEqual(["CheckCompanySignupEntry"]);
  });

  test("route の printer は path と search を組み立て、search の欠けは型エラーになる", () => {
    expect(companySignupRouter.build(DEFAULT_SIGNUP_TARGET)).toBe(
      "/auth/signup/company?service_name=accounts&redirect_url=http%3A%2F%2Flocalhost%2Faccount",
    );
    // @ts-expect-error redirect_url の無い search では route を組み立てられない
    expect(() => companySignupRouter.build({ service_name: "accounts" })).toThrow();
  });
});
