import { afterEach, describe, expect, test } from "bun:test";

import {
  acceptInvitation,
  createInvitation,
  listInvitations,
  revokeInvitation,
} from "../invitation-api";
import { RequestJsonError } from "../../shared/request-json";
import { postInit, restoreFetch, stubFetch } from "../../shared/__tests__/fetch-stub";

afterEach(restoreFetch);

const invitations = [
  {
    id: "invitation-1",
    email: "invitee@example.com",
    role: "MEMBER",
    expires_at: "2026-01-02T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
  },
];

describe("invitation API", () => {
  test("invitations を既存 GET から取り出す", async () => {
    const fetchSpy = stubFetch(Response.json({ invitations }));

    expect(await listInvitations("company-1")).toEqual(invitations);
    expect(fetchSpy).toHaveBeenCalledWith("/api/account/companies/company-1/invitations", {
      credentials: "include",
    });
  });

  test.each([true, false])("create は reused=%s を保つ", async (reused) => {
    const fetchSpy = stubFetch(Response.json({ reused }));
    const input = { email: "invitee@example.com", role: "MEMBER" as const };

    expect(await createInvitation("company-1", input)).toEqual({ reused });
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/account/companies/company-1/invitations",
      postInit(input),
    );
  });

  test("revoke は既存 URL を body なしで呼ぶ", async () => {
    const fetchSpy = stubFetch(Response.json({ ok: true }));

    await expect(revokeInvitation("company-1", "invitation-1")).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/account/companies/company-1/invitations/invitation-1/revoke",
      postInit(),
    );
  });

  test("accept は invitation_token を送り company_id を保つ", async () => {
    const fetchSpy = stubFetch(Response.json({ company_id: "company-1" }));

    expect(await acceptInvitation("token-1")).toEqual({ company_id: "company-1" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/account/accept-invitation",
      postInit({ invitation_token: "token-1" }),
    );
  });

  test.each([
    ["list", () => listInvitations("company-1")],
    ["create", () => createInvitation("company-1", { email: "x@example.com", role: "MEMBER" })],
    ["revoke", () => revokeInvitation("company-1", "invitation-1")],
    ["accept", () => acceptInvitation("token-1")],
  ])("%s は HTTP status error を保つ", async (_name, run) => {
    stubFetch(new Response(null, { status: 403 }));

    const rejection = run();
    await expect(rejection).rejects.toBeInstanceOf(RequestJsonError);
    await expect(rejection).rejects.toMatchObject({ status: 403 });
  });
});
