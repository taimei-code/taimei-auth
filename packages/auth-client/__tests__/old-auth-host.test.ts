import { describe, expect, test } from "bun:test";
import { createFetchClient } from "@connectrpc/connect/protocol";
import { createTransport } from "@connectrpc/connect/protocol-connect";
import { createAuthGuard } from "../src/guard";
import { createAuthClient } from "../src/server";

const verifySessionOk = {
  ok: {
    user: { id: "u1", name: "n", email: "e", emailVerified: true, defaultCompanyId: "cmp_1" },
    session: { id: "s1", expiresAt: "2030-01-01T00:00:00Z", sessionKind: "user" },
  },
};

const oldAuthHostFetch = (requestedPaths: string[]) => async (input: RequestInfo | URL) => {
  const { pathname } = new URL(input instanceof Request ? input.url : input);
  requestedPaths.push(pathname);
  if (pathname.endsWith("/VerifySession")) {
    return Response.json(verifySessionOk);
  }
  if (pathname.endsWith("/ListCurrentCompanyMembers")) {
    return Response.json({ ok: { companyId: "cmp_1", members: [] } });
  }
  return Response.json({ _tag: "NotFound" }, { status: 404 });
};

describe("GetSession を持たない auth ホスト", () => {
  test("HTTP 404 は Connect の client で Unimplemented になり、getSession は VerifySession と ListCurrentCompanyMembers へ送り直して ok を返す", async () => {
    const requestedPaths: string[] = [];
    const transport = createTransport({
      baseUrl: "http://auth.test/rpc",
      httpClient: createFetchClient(oldAuthHostFetch(requestedPaths) as typeof fetch),
      useBinaryFormat: false,
      interceptors: [],
      acceptCompression: [],
      sendCompression: null,
      compressMinBytes: 0,
      readMaxBytes: 0xffffffff,
      writeMaxBytes: 0xffffffff,
    });
    const guard = createAuthGuard({
      client: createAuthClient({ transport }),
      getSessionToken: async () => "valid-token",
    });

    const result = await guard.getSession();

    expect(requestedPaths).toEqual([
      "/rpc/auth.v1.AuthService/GetSession",
      "/rpc/auth.v1.AuthService/VerifySession",
      "/rpc/auth.v1.AuthService/ListCurrentCompanyMembers",
    ]);
    expect(result.ok && result.data.user.id).toBe("u1");
  });
});
