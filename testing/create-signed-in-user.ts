import { Effect } from "effect";
import { AuthApi } from "../src/auth-service";
import { addCompany } from "../src/company/create";
import { acceptInvitation } from "../src/invitation/accept";
import { createInvitation } from "../src/invitation/create";
import { switchCurrentCompany } from "../src/membership/current-company";
import { requireInvitationAccept, requireInvite } from "../src/membership/guard";
import type { Role } from "../src/membership/policy";
import { takeSentLink } from "./sent-links";

const TEST_COMPANY_ORG_CODE = "CORPORATE";

const testEmail = (purpose: "user" | "owner") =>
  `test-${purpose}-${crypto.randomUUID()}@example.com`;

const actorOf = (user: { id: string; email: string }) => ({
  id: user.id,
  email: user.email,
  lastUsedCompanyId: null,
});

const joinByInvitation = Effect.fnUntraced(
  function* (
    invitee: { id: string; email: string },
    owner: { id: string; email: string },
    companyId: string,
    role: Role,
  ) {
    const invite = yield* requireInvite({
      actor: actorOf(owner),
      companyId,
      body: { email: invitee.email, role },
    });
    const { invitation } = yield* createInvitation(invite);
    const grant = yield* requireInvitationAccept({
      actor: actorOf(invitee),
      token: invitation.token,
    });
    if (grant.mode === "reused") return;
    yield* acceptInvitation(grant);
  },
  Effect.catchTag(
    ["Forbidden", "RateLimited", "NotFound", "EmailMismatch", "ExpiredOrUsed"],
    (failure) => Effect.die(failure),
  ),
);

const companyWithRole = Effect.fnUntraced(function* (
  user: { id: string; email: string },
  company: { name?: string; role: Role },
) {
  const name = company.name ?? "Test Company";
  if (company.role === "OWNER") {
    const created = yield* addCompany(user.id, { name, orgCode: TEST_COMPANY_ORG_CODE });
    return created.company.id;
  }
  const authApi = yield* AuthApi;
  const owner = yield* authApi.createUser({ email: testEmail("owner"), name: "Test Owner" });
  const created = yield* addCompany(owner.id, { name, orgCode: TEST_COMPANY_ORG_CODE });
  yield* joinByInvitation(user, owner, created.company.id, company.role);
  return created.company.id;
});

export const createSignedInUser = Effect.fnUntraced(function* (input: {
  name?: string;
  companies: readonly { name?: string; role: Role }[];
  returnTo: string;
}) {
  const authApi = yield* AuthApi;
  const email = testEmail("user");
  const user = yield* authApi.createUser({ email, name: input.name ?? "Test User" });

  const companyIds: string[] = [];
  for (const company of input.companies) {
    companyIds.push(yield* companyWithRole(user, company));
  }
  const [current] = companyIds;
  if (current !== undefined) {
    yield* switchCurrentCompany({ userId: user.id, companyId: current }).pipe(
      Effect.catchTag("Forbidden", (forbidden) => Effect.die(forbidden)),
    );
  }

  yield* authApi.signInMagicLink({ email, callbackURL: input.returnTo });
  const loginUrl = yield* takeSentLink(email, input.returnTo);
  if (loginUrl === undefined) {
    return yield* Effect.die(
      new Error("no email to the test user was recorded with returnTo as its callbackURL"),
    );
  }
  return { userId: user.id, email, companyIds, loginUrl };
});
