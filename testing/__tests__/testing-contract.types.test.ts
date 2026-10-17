import { expect, test } from "bun:test";
import type * as Sdk from "@taimei-code/auth-client/testing";
import type { Schema } from "effect";
import type { SetCurrentCompanyRequest, SignedInUserRequest } from "../testing-contract";

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const _signedInUserRequest: Same<
  Schema.Schema.Type<typeof SignedInUserRequest>,
  Sdk.SignedInUserRequest
> = true;
const _setCurrentCompanyRequest: Same<
  Schema.Schema.Type<typeof SetCurrentCompanyRequest>,
  Sdk.SetCurrentCompanyRequest
> = true;

test("server が decode する request の型と SDK の request の型は同じ (typecheck で検査する)", () => {
  expect([_signedInUserRequest, _setCurrentCompanyRequest]).toEqual([true, true]);
});
