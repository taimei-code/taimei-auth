import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { AuthApi } from "../auth-service";
import { checkSession } from "../session-check";
import { dbTest } from "./live-runner";
import {
  browserCookieHeaders,
  issuedSessionSetCookies,
  loginWithMagicLink,
  setCookieValue,
} from "./session-helpers";
import { TestDb } from "./test-db";

const P = "session-revocation-";
const { run } = dbTest(P);
const CALLBACK = "https://app.example.com/dashboard";

const cleanup = () => run(TestDb.use((db) => db.cleanup()));

describe("session の判定は cookieCache を使わず毎回 TTL store を見るので、失効させた session は直後から使えない", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("TTL store から消した session は、ログインで受け取った cookie をすべて送っても直後から session が無いとみなす", () =>
    run(
      Effect.gen(function* () {
        const user = yield* (yield* TestDb).seedUser("revoked");
        const login = yield* loginWithMagicLink({ email: user.email, callbackURL: CALLBACK });
        const headers = browserCookieHeaders(login.response);
        const [sessionCookie] = yield* issuedSessionSetCookies(login.response.headers);
        const token = setCookieValue(sessionCookie).split(".")[0];

        expect((yield* checkSession(headers))._tag).toBe("Active");

        yield* AuthApi.use((authApi) => authApi.deleteSession(token));

        expect((yield* checkSession(headers))._tag).toBe("NoSession");
      }),
    ));
});
