import { expect, test } from "bun:test";
import type * as Sdk from "@taimei-code/auth-client/testing";
import type { Effect, Schema } from "effect";
import type { createSignedInUser } from "../create-signed-in-user";
import type { SignedInUserRequest } from "../testing-contract";

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const requestTypesMatch: Same<
  Schema.Schema.Type<typeof SignedInUserRequest>,
  Sdk.SignedInUserRequest
> = true;
const responseTypesMatch: Same<
  Effect.Success<ReturnType<typeof createSignedInUser>>,
  Sdk.SignedInUser
> = true;

test("server が decode する request の型と返す response の型は、SDK の型と同じ (typecheck で検査する)", () => {
  expect([requestTypesMatch, responseTypesMatch]).toEqual([true, true]);
});
