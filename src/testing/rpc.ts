import { createConnectRouter } from "@connectrpc/connect";
import { createFetchHandler } from "@connectrpc/connect/protocol";
import { Role as ProtoRole } from "../gen/auth/v1/auth_pb";
import { TestingService } from "../gen/auth/testing/v1/testing_pb";
import { createSignedInUser, setCurrentCompany } from "./routes";

export const TESTING_RPC_PATH = "/testing/rpc";

const ROLE_BY_PROTO = {
  [ProtoRole.OWNER]: "OWNER",
  [ProtoRole.ADMIN]: "ADMIN",
  [ProtoRole.MEMBER]: "MEMBER",
} as const;

const router = createConnectRouter();
router.service(TestingService, {
  async createSignedInUser(request) {
    const created = await createSignedInUser({
      name: request.name,
      companies: request.companies.map((entry) => ({
        id: entry.id,
        name: entry.name,
        role: ROLE_BY_PROTO[entry.role as keyof typeof ROLE_BY_PROTO] ?? "MEMBER",
      })),
      currentCompanyId: request.currentCompanyId,
      returnTo: request.returnTo,
    });
    return {
      userId: created.userId,
      email: created.email,
      companyIds: created.companyIds,
      loginUrl: created.loginUrl,
    };
  },
  async setCurrentCompany(request) {
    await setCurrentCompany({ userId: request.userId, companyId: request.companyId });
    return {};
  },
});

const handlers = new Map(router.handlers.map((h) => [h.requestPath, createFetchHandler(h)]));

export const handleTestingRpc = async (req: Request): Promise<Response | null> => {
  const url = new URL(req.url);
  const handler = handlers.get(url.pathname.slice(TESTING_RPC_PATH.length));
  if (!handler) return null;
  url.pathname = url.pathname.slice(TESTING_RPC_PATH.length);
  return handler(new Request(url, req));
};
