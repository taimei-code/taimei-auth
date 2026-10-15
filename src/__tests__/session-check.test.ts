import { describe, expect, test } from "bun:test";
import { Effect, Exit, Layer } from "effect";
import type { UserRow } from "@/db/repositories/user";
import type { UserRepo } from "../account/ports";
import type { Session } from "../auth";
import type { AuthApi } from "../auth-service";
import { AuthApiError, DbError } from "../errors";
import {
  authFailing,
  authLayer,
  sessionOf,
  userRepoFailing,
  userRepoLayer,
} from "../membership/__tests__/test-layers";
import { checkSession } from "../session-check";

const userRow = { id: "u1", email: "u1@example.com" } as unknown as UserRow;

const check = (layer: Layer.Layer<AuthApi | UserRepo>) =>
  Effect.runPromiseExit(checkSession(new Headers()).pipe(Effect.provide(layer)));

describe("checkSession は有効な session の判定を 1 か所で返す", () => {
  test("session が無ければ NoSession", async () => {
    const exit = await check(
      Layer.mergeAll(
        authLayer(() => null),
        userRepoLayer([userRow]),
      ),
    );

    expect(exit).toEqual(Exit.succeed({ _tag: "NoSession" }));
  });

  test("user の id の無い session は NoSession", async () => {
    const withoutUser = { session: { userId: "u1" }, user: {} } as unknown as Session;

    const exit = await check(
      Layer.mergeAll(
        authLayer(() => withoutUser),
        userRepoLayer([userRow]),
      ),
    );

    expect(exit).toEqual(Exit.succeed({ _tag: "NoSession" }));
  });

  test("user 行の無い user の session は UserDeleted", async () => {
    const exit = await check(
      Layer.mergeAll(
        authLayer(() => sessionOf("u1")),
        userRepoLayer([]),
      ),
    );

    expect(Exit.isSuccess(exit) && exit.value._tag).toBe("UserDeleted");
  });

  test("user 行のある session は、その user 行を持つ Active", async () => {
    const exit = await check(
      Layer.mergeAll(
        authLayer(() => sessionOf("u1")),
        userRepoLayer([userRow]),
      ),
    );

    expect(Exit.isSuccess(exit) && exit.value._tag === "Active" && exit.value.user).toBe(userRow);
  });

  test("getSession の AuthApiError はそのまま失敗で返す (握るかどうかは呼び手が決める)", async () => {
    const exit = await check(Layer.mergeAll(authFailing("down"), userRepoLayer([userRow])));

    expect(exit).toEqual(Exit.fail(new AuthApiError({ cause: "down" })));
  });

  test("user 行の読み出しの DbError はそのまま失敗で返す", async () => {
    const exit = await check(
      Layer.mergeAll(
        authLayer(() => sessionOf("u1")),
        userRepoFailing("down"),
      ),
    );

    expect(exit).toEqual(Exit.fail(new DbError({ cause: "down" })));
  });
});
