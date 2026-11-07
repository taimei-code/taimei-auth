import { describe, expect, test } from "bun:test";
import { Effect, Option, pipe, Schema, SchemaIssue } from "effect";
import { Route } from "foldkit";
import { defineRouteUnion, literal } from "foldkit/route";
import * as Url from "foldkit/url";
import type { z } from "zod";

import { type SignInParams, signInParamsSchema } from "@core/sign-in-params";

const fromZod = <T>(schema: z.ZodType<T>) =>
  Schema.declareConstructor<T, Readonly<Record<string, string>>>()([], () => (input) => {
    const parsed = schema.safeParse(input);
    return parsed.success
      ? Effect.succeed(parsed.data)
      : Effect.fail(new SchemaIssue.InvalidValue({ message: parsed.error.message }, input));
  });

const SignInSearch = fromZod<SignInParams>(signInParamsSchema);

const AuthRoute = defineRouteUnion({
  SignIn: {
    service_name: Schema.Literals(["taimei", "accounts"]),
    redirect_url: Schema.String,
    sign_up_url: Schema.optional(Schema.String),
    invitation_token: Schema.optional(Schema.String),
  },
  NotFound: { path: Schema.String },
});

const signInRouter = pipe(
  literal("auth"),
  Route.query(SignInSearch),
  Route.mapTo(AuthRoute.SignIn),
);

const urlToAuthRoute = Route.parseUrlWithFallback(signInRouter, AuthRoute.NotFound);

const routeOf = (href: string) =>
  Option.match(Url.fromString(href), {
    onNone: () => AuthRoute.NotFound({ path: href }),
    onSome: urlToAuthRoute,
  });

describe("server と共有する zod の search の schema を、@core を変えずに Foldkit の route で読む", () => {
  test("zod の検査に通る search は、zod が parse した値を route に持つ", () => {
    expect(
      Schema.decodeSync(SignInSearch)({
        service_name: "accounts",
        redirect_url: "http://localhost/account",
        error: "signin_failed",
      }),
    ).toEqual({ service_name: "accounts", redirect_url: "http://localhost/account" });
  });

  test("許可されていない redirect_url は zod の検査で落ちる (検査の本体は @core の 1 つのまま)", () => {
    expect(() =>
      Schema.decodeSync(SignInSearch)({
        service_name: "accounts",
        redirect_url: "https://evil.example",
      }),
    ).toThrow("redirect_url is not in allowlist");
  });

  test("route の parser は、zod の検査に通る search を route の値にする", () => {
    expect(
      routeOf(
        "http://localhost/auth?service_name=accounts&redirect_url=http%3A%2F%2Flocalhost%2Faccount",
      ),
    ).toEqual(
      AuthRoute.SignIn({ service_name: "accounts", redirect_url: "http://localhost/account" }),
    );
  });

  test("route の parser は、zod の検査で落ちる search を route にしない", () => {
    expect(
      routeOf("http://localhost/auth?service_name=accounts&redirect_url=https%3A%2F%2Fevil.example")
        ._tag,
    ).toBe("NotFound");
  });

  test("route の printer は、zod の schema を包んだ search から URL を組み立てる", () => {
    expect(
      signInRouter.build({ service_name: "accounts", redirect_url: "http://localhost/account" }),
    ).toBe("/auth?service_name=accounts&redirect_url=http%3A%2F%2Flocalhost%2Faccount");
  });
});
