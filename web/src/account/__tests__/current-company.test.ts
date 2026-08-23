import { afterEach, describe, expect, test } from "bun:test";

import { getCompanyState, listMyMemberships, setCurrentCompany } from "../current-company";
import { RequestJsonError } from "../../shared/request-json";
import { postInit, restoreFetch, stubFetch } from "../../shared/__tests__/fetch-stub";

afterEach(restoreFetch);

const state = {
  current_company_id: "company-1",
  memberships: [
    {
      id: "membership-1",
      company_id: "company-1",
      company_name: "Example",
      company_org_code: "CORPORATE",
      role: "OWNER",
      joined_at: "2026-01-01T00:00:00.000Z",
    },
  ],
};

describe("current company API", () => {
  test("state を credentials 付き GET で取得する", async () => {
    const fetchSpy = stubFetch(Response.json(state));

    expect(await getCompanyState()).toEqual(state);
    expect(fetchSpy).toHaveBeenCalledWith("/api/account/memberships", {
      credentials: "include",
    });
  });

  test("memberships projection は同じ state GET を再利用する", async () => {
    const fetchSpy = stubFetch(Response.json(state));

    expect(await listMyMemberships()).toEqual(state.memberships);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith("/api/account/memberships", {
      credentials: "include",
    });
  });

  test("current company を既存 body で切り替える", async () => {
    const fetchSpy = stubFetch(Response.json({ ok: true }));

    await expect(setCurrentCompany("company-2")).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/account/current-company",
      postInit({ company_id: "company-2" }),
    );
  });

  test.each([
    ["getCompanyState", () => getCompanyState()],
    ["listMyMemberships", () => listMyMemberships()],
    ["setCurrentCompany", () => setCurrentCompany("company-2")],
  ])("%s は HTTP status error を保つ", async (_name, run) => {
    stubFetch(new Response(null, { status: 403 }));

    const rejection = run();
    await expect(rejection).rejects.toBeInstanceOf(RequestJsonError);
    await expect(rejection).rejects.toMatchObject({ status: 403 });
  });
});
