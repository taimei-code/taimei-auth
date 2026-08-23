import { afterEach, describe, expect, test } from "bun:test";

import { addCompany, createCompany, deleteCompany, updateCompany } from "../company-api";
import { RequestJsonError } from "../../shared/request-json";
import { postInit, restoreFetch, stubFetch } from "../../shared/__tests__/fetch-stub";

afterEach(restoreFetch);

const created = {
  company: {
    id: "company-1",
    name: "Example",
    org_code: "CORPORATE",
    activation_status: "ACTIVE",
    created_at: "2026-01-01T00:00:00.000Z",
  },
  membership: {
    id: "membership-1",
    role: "OWNER",
    company_id: "company-1",
    joined_at: "2026-01-01T00:00:00.000Z",
  },
};

describe("company API", () => {
  test.each([
    ["create", createCompany, "/api/account/companies"],
    ["add", addCompany, "/api/account/companies/add"],
  ] as const)("%s は既存 POST contract を保つ", async (_name, run, url) => {
    const fetchSpy = stubFetch(Response.json(created));
    const input = { name: "Example", org_code: "CORPORATE" as const };

    expect(await run(input)).toEqual(created);
    expect(fetchSpy).toHaveBeenCalledWith(url, postInit(input));
  });

  test("update は既存 URL と body を保ち caller には void を返す", async () => {
    const fetchSpy = stubFetch(Response.json({ company: { id: "company-1" } }));
    const input = { name: "Updated", org_code: "PERSONAL" as const };

    await expect(updateCompany("company-1", input)).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledWith("/api/account/companies/company-1", postInit(input));
  });

  test.each([
    [true, true],
    [false, false],
  ])("delete は account_deleted=%s を camelCase=%s に写す", async (wire, expected) => {
    const fetchSpy = stubFetch(Response.json({ ok: true, account_deleted: wire }));

    expect(await deleteCompany("company-1")).toEqual({ accountDeleted: expected });
    expect(fetchSpy).toHaveBeenCalledWith("/api/account/companies/company-1/delete", postInit());
  });

  test.each([
    ["create", () => createCompany({ name: "X", org_code: "CORPORATE" })],
    ["add", () => addCompany({ name: "X", org_code: "CORPORATE" })],
    ["update", () => updateCompany("company-1", { name: "X", org_code: "CORPORATE" })],
    ["delete", () => deleteCompany("company-1")],
  ])("%s は HTTP status error を保つ", async (_name, run) => {
    stubFetch(new Response(null, { status: 403 }));

    const rejection = run();
    await expect(rejection).rejects.toBeInstanceOf(RequestJsonError);
    await expect(rejection).rejects.toMatchObject({ status: 403 });
  });
});
