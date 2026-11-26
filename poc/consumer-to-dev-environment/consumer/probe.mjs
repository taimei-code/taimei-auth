import { createConnectTransport } from "@connectrpc/connect-web";
import {
  AUTH_RPC_PATH,
  createAuthClient,
  createAuthGuard,
  createServiceKeyInterceptor,
  extractSessionTokenFromCookieHeader,
} from "@taimei-code/auth-client";
import { createTestingClient } from "@taimei-code/auth-client/testing";

const authUrl = process.env.AUTH_SERVICE_URL ?? "";
const serviceKey = process.env.AUTH_SERVICE_KEY ?? "";

const health = await fetch(`${authUrl}/health`);
const availability = await (await fetch(`${authUrl}/api/passkey/sign-in/availability`)).json();
const user = await createTestingClient(authUrl).createSignedInUser({
  companies: [{ role: "OWNER" }],
  returnTo: "http://app.taimei-code.localhost:3001/auth/after-signin",
});
const signedIn = await fetch(user.loginUrl, { redirect: "manual" });
const cookieHeader = signedIn.headers
  .getSetCookie()
  .map((cookie) => cookie.split(";")[0])
  .join("; ");
const guard = createAuthGuard({
  client: createAuthClient({
    transport: createConnectTransport({
      baseUrl: `${authUrl}${AUTH_RPC_PATH}`,
      interceptors: [createServiceKeyInterceptor(serviceKey)],
    }),
  }),
  getSessionToken: async () => extractSessionTokenFromCookieHeader(cookieHeader),
});
const session = await guard.getSession();

console.log(
  JSON.stringify({
    health: health.status,
    passkeyAvailability: availability,
    createdUser: user.userId,
    loginStatus: signedIn.status,
    loginLocation: signedIn.headers.get("location"),
    session,
  }),
);
