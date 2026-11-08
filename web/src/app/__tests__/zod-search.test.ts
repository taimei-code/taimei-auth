import { describe, expect, test } from "bun:test";
import { Schema } from "effect";

import { type SignInParams, signInParamsSchema } from "@core/sign-in-params";

import { fromZodSearch } from "../zod-search";

const SignInSearch = fromZodSearch<SignInParams>(signInParamsSchema);

describe("server と共有する zod の search の schema を、@core を変えずに Effect Schema で読む", () => {
  test("zod の検査に通る search は、zod が parse した値になり、宣言していない key を落とす", () => {
    expect(
      Schema.decodeSync(SignInSearch)({
        service_name: "accounts",
        redirect_url: "https://auth.taimei-code.com/account",
        error: "signin_failed",
      }),
    ).toEqual({ service_name: "accounts", redirect_url: "https://auth.taimei-code.com/account" });
  });

  test("許可されていない redirect_url は zod の検査で落ちる (検査の本体は @core の 1 つのまま)", () => {
    expect(() =>
      Schema.decodeSync(SignInSearch)({
        service_name: "accounts",
        redirect_url: "https://evil.example.com/",
      }),
    ).toThrow("redirect_url is not in allowlist");
  });
});
