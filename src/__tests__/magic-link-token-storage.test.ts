import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { magicLinkUrlFor } from "../../testing/sent-links";
import { followMagicLink } from "./session-helpers";
import { dbTest } from "./live-runner";
import { TestDb } from "./test-db";
import { betterAuthKeyOf, testKvStore } from "./test-ttl-store";

const P = "magic-link-token-storage-";
const { run } = dbTest(P);
const CALLBACK = "https://app.example.com/dashboard";

const cleanup = () => run(TestDb.use((db) => db.cleanup()));

describe("Magic Link の token は hash した key で TTL store に置く", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("送った Magic Link の token は、平文の key では TTL store に無く、link を開くとログインできる", () =>
    run(
      Effect.gen(function* () {
        const user = yield* (yield* TestDb).seedUser("hashed");

        const link = yield* magicLinkUrlFor(user.email, CALLBACK);
        const token = new URL(link).searchParams.get("token");

        expect(token).not.toBeNull();
        expect(testKvStore.get(betterAuthKeyOf(`verification:${token}`))).toBeNull();

        const login = yield* followMagicLink(link);
        expect(login.location?.toString()).toBe(CALLBACK);
      }),
    ));
});
