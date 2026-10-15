import type { ConnectRouter, ServiceImpl } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { createAuthClient, createServiceKeyInterceptor } from "@taimei-code/auth-client";
import { AuthService } from "../../../../src/gen/auth/v1/auth_pb";

type StrictClientOptions = {
  readonly baseUrl: string;
  readonly fetch: typeof globalThis.fetch;
  readonly serviceKey: string;
};

const createAuthClientStrict = (options: StrictClientOptions) =>
  createAuthClient({
    transport: createConnectTransport({
      baseUrl: options.baseUrl,
      fetch: options.fetch,
      interceptors: [createServiceKeyInterceptor(options.serviceKey)],
    }),
  });

export const withKey = createAuthClientStrict({ baseUrl: "https://x/rpc", fetch, serviceKey: "k" });
// @ts-expect-error S3
export const withoutKey = createAuthClientStrict({ baseUrl: "https://x/rpc", fetch });

export const serverAPrime = (router: ConnectRouter) => {
  router.service(AuthService, {
    verifySession: async () => ({}),
    // @ts-expect-error K4
  } satisfies ServiceImpl<typeof AuthService>);
};
