import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { UserRepo } from "../account/ports";
import { auth } from "../auth";
import { UpdateUserRequestSchema } from "../gen/auth/v1/auth_pb";
import { createSessionFor } from "../mfa/__tests__/helpers";
import { dbTest } from "./live-runner";
import { TestDb } from "./test-db";

const P = "email-immutable-";
const { run, cleanup } = dbTest(P);
const newEmail = `${P}new@example.com`;

const rejection = (call: () => Promise<unknown>) =>
  Effect.tryPromise({ try: call, catch: (e) => e }).pipe(Effect.flip);

const emailInDb = (userId: string) =>
  TestDb.use((db) => db.readUser(userId)).pipe(Effect.map((u) => u?.email));

describe("公開している経路からはメールアドレスを変更できない", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("/update-user に email を送ると拒否され、DB の email は変わらない", () =>
    run(
      Effect.gen(function* () {
        const user = yield* TestDb.use((db) => db.seedUser("update"));
        const { headers } = yield* createSessionFor(user.id);

        const rejected = yield* rejection(() =>
          // @ts-expect-error email は better-auth の updateUser の入力に無い
          auth.api.updateUser({ headers, body: { email: newEmail } }),
        );

        expect(rejected).toMatchObject({ body: { code: "EMAIL_CAN_NOT_BE_UPDATED" } });
        expect(yield* emailInDb(user.id)).toBe(user.email);
      }),
    ));

  test("/change-email は無効で、DB の email は変わらない", () =>
    run(
      Effect.gen(function* () {
        const user = yield* TestDb.use((db) => db.seedUser("change"));
        const { headers } = yield* createSessionFor(user.id);

        const rejected = yield* rejection(() =>
          auth.api.changeEmail({ headers, body: { newEmail } }),
        );

        expect(rejected).toMatchObject({ body: { code: "CHANGE_EMAIL_DISABLED" } });
        expect(yield* emailInDb(user.id)).toBe(user.email);
      }),
    ));

  test("RPC の UpdateUserRequest に email を含む名前の項目が無い", () => {
    const names = UpdateUserRequestSchema.fields.map((f) => f.name);
    expect(names.filter((name) => name.includes("email"))).toEqual([]);
  });

  test("UserRepo.updateUser に email は渡せない", () => {
    const writeEmail = (users: UserRepo["Service"]) =>
      // @ts-expect-error email は UserRepo.updateUser の更新項目に無い
      users.updateUser("user-id", { email: newEmail });
    expect(writeEmail).toBeFunction();
  });
});
