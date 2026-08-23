import { afterEach, describe, expect, test } from "bun:test";

import { listMembers, removeMember, transferOwnership, updateMemberRole } from "../membership-api";
import { RequestJsonError } from "../../shared/request-json";
import { postInit, restoreFetch, stubFetch } from "../../shared/__tests__/fetch-stub";

afterEach(restoreFetch);

const members = [
  {
    membership_id: "membership-1",
    user_id: "user-1",
    user_name: "User",
    user_email: "user@example.com",
    role: "OWNER",
    joined_at: "2026-01-01T00:00:00.000Z",
  },
];

describe("membership API", () => {
  test("members を既存 GET から取り出す", async () => {
    const fetchSpy = stubFetch(Response.json({ members }));

    expect(await listMembers("company-1")).toEqual(members);
    expect(fetchSpy).toHaveBeenCalledWith("/api/account/companies/company-1/members", {
      credentials: "include",
    });
  });

  test("role を既存 POST body で更新する", async () => {
    const fetchSpy = stubFetch(Response.json({ ok: true }));

    await expect(updateMemberRole("company-1", "user-1", "ADMIN")).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/account/companies/company-1/members/user-1/role",
      postInit({ role: "ADMIN" }),
    );
  });

  test("remove は account_deleted を camelCase に写す", async () => {
    const fetchSpy = stubFetch(Response.json({ ok: true, account_deleted: true }));

    expect(await removeMember("company-1", "user-1")).toEqual({ accountDeleted: true });
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/account/companies/company-1/members/user-1/remove",
      postInit(),
    );
  });

  test("OWNER 委譲は to_user_id を送る", async () => {
    const fetchSpy = stubFetch(Response.json({ ok: true }));

    await expect(transferOwnership("company-1", "user-2")).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/account/companies/company-1/transfer-ownership",
      postInit({ to_user_id: "user-2" }),
    );
  });

  test.each([
    ["list", () => listMembers("company-1")],
    ["role", () => updateMemberRole("company-1", "user-1", "ADMIN")],
    ["remove", () => removeMember("company-1", "user-1")],
    ["transfer", () => transferOwnership("company-1", "user-2")],
  ])("%s は HTTP status error を保つ", async (_name, run) => {
    stubFetch(new Response(null, { status: 403 }));

    const rejection = run();
    await expect(rejection).rejects.toBeInstanceOf(RequestJsonError);
    await expect(rejection).rejects.toMatchObject({ status: 403 });
  });
});
