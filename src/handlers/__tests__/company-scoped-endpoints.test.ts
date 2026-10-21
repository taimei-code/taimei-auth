import { describe, expect, test } from "bun:test";
import { Layer } from "effect";
import { membershipRepoLayer, signedIn } from "../../membership/__tests__/test-layers";
import { JSON_HEADERS } from "../client-facing-error";
import { spaEndpointTable } from "../../spa-contract-table";
import { buildAppWith, SESSION_COOKIE_HEADER } from "./helpers";

const SAMPLE_PAYLOADS: Record<string, unknown> = {
  "POST /api/account/companies/:companyId/members/:targetUserId/role": { role: "ADMIN" },
  "POST /api/account/companies/:companyId/transfer-ownership": { to_user_id: "u_other" },
  "POST /api/account/companies/:companyId": { name: "Acme", org_code: "CORPORATE" },
  "POST /api/account/companies/:companyId/invitations": {
    email: "invitee@example.com",
    role: "MEMBER",
  },
};

const companyScoped = spaEndpointTable().filter(({ path }) => path.includes(":companyId"));
const keyOf = ({ method, path }: { method: string; path: string }) => `${method} ${path}`;

const requestPath = (path: string) =>
  path.replace(":companyId", "co_none").replace(/:[A-Za-z]+/g, "x_1");

describe("事業所を指す SPA の endpoint は、所属の無い利用者に 403 を返す", () => {
  test("見本の payload の表は、payload を持つ事業所の endpoint と過不足なく対応する", () => {
    expect(
      companyScoped
        .filter(({ hasPayload }) => hasPayload)
        .map(keyOf)
        .sort(),
    ).toEqual(Object.keys(SAMPLE_PAYLOADS).sort());
  });

  test.each(
    companyScoped.map((endpoint) => [keyOf(endpoint), endpoint] as const),
  )("%s は所属の無い利用者に 403 Forbidden を返す", async (key, { method, path }) => {
    const app = buildAppWith(Layer.mergeAll(signedIn("u_outsider"), membershipRepoLayer([])));
    const payload = SAMPLE_PAYLOADS[key];
    const res = await app.request(requestPath(path), {
      method,
      headers: { ...JSON_HEADERS, ...SESSION_COOKIE_HEADER },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()) as unknown).toEqual({ _tag: "Forbidden" });
  });
});
