import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { invitationLogLine } from "../../../testing/local-delivery-log";
import { magicLinkUrlFor } from "../../../testing/sent-links";
import { acceptInvitationPath } from "../../invitation/accept-path";
import { followMagicLink, loginWithMagicLink } from "../../__tests__/session-helpers";
import { dbTest, observing } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { getAppUrl } from "../client";

const P = "dispatch-magic-link-";
const { run } = dbTest(P);

const CALLBACK_WITH_ENCODED_QUERY =
  "https://app.example.com/dashboard?next=%2Fx%3Fa%3D1%26b%3D2%23top&rate=100%25";

const cleanup = () => run(TestDb.use((db) => db.cleanup()));

describe("送った Magic Link を開くと、callbackURL へそのまま移る", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("ログインの endpoint から送った Magic Link を開くと、%26 を含む query の callbackURL へそのまま移る", () =>
    run(
      Effect.gen(function* () {
        const user = yield* (yield* TestDb).seedUser("endpoint");

        const login = yield* loginWithMagicLink({
          email: user.email,
          callbackURL: CALLBACK_WITH_ENCODED_QUERY,
        });

        expect(login.location?.toString()).toBe(CALLBACK_WITH_ENCODED_QUERY);
      }),
    ));

  test("server から AuthApi.signInMagicLink で送った Magic Link を開くと、%26 を含む query の callbackURL へそのまま移る", () =>
    run(
      Effect.gen(function* () {
        const user = yield* (yield* TestDb).seedUser("server");

        const link = yield* magicLinkUrlFor(user.email, CALLBACK_WITH_ENCODED_QUERY);
        const login = yield* followMagicLink(link);

        expect(login.location?.toString()).toBe(CALLBACK_WITH_ENCODED_QUERY);
      }),
    ));

  test("redirect_url に & を含む招待の受諾の URL を callbackURL にすると、招待のメールとして送り、開くと redirect_url をそのまま保つ", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("inviter");
        const companyId = yield* db.seedCompany("invitation");
        yield* db.seedMembership(owner.id, companyId, "OWNER");
        const inviteeEmail = `${P}invitee@example.com`;
        const invitation = yield* db.seedInvitation({
          companyId,
          email: inviteeEmail,
          role: "MEMBER",
          invitedByUserId: owner.id,
        });
        const redirectUrl = "https://app.example.com/dashboard?a=1&b=2";
        const callbackURL = `${getAppUrl()}${acceptInvitationPath(invitation.token, {
          service_name: "taimei",
          redirect_url: redirectUrl,
        })}`;

        const { value: link, logs } = yield* observing(magicLinkUrlFor(inviteeEmail, callbackURL));
        const login = yield* followMagicLink(link);

        expect(logs).toContain(invitationLogLine(inviteeEmail, link));
        expect(login.location?.searchParams.get("redirect_url")).toBe(redirectUrl);
      }),
    ));
});
