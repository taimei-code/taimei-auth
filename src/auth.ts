import { MAGIC_LINK_EXPIRES_IN_SECONDS } from "@taimei-code/auth-client";
import { betterAuth } from "better-auth";
import { isAPIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { primaryAuth } from "./auth-plugins/primary-auth";
import { revokeOnlySessionTokens } from "./auth-plugins/revoke-only-session-tokens";
import { getAppName } from "./email/client";
import { dispatchMagicLink } from "./email/dispatch-magic-link";
import { CLIENT_IP_HEADER } from "./client-ip";
import { resolveCrossSubDomainCookies } from "./cookie-domain";
import { getTrustedOrigins } from "./env";
import { captureThrown } from "./handlers/client-facing-error";
import { requireAuthSecret } from "./auth-secret";
import { betterAuthStorage } from "./ttl-store-better-auth";
import type { AppRuntime } from "./runtime";

function buildAuth(runtime: AppRuntime) {
  return betterAuth({
    baseURL: process.env.AUTH_SERVICE_URL,

    secret: requireAuthSecret(process.env.AUTH_SECRET),

    appName: getAppName(),

    secondaryStorage: betterAuthStorage(runtime),

    advanced: {
      useSecureCookies: true,
      crossSubDomainCookies: resolveCrossSubDomainCookies(process.env.AUTH_COOKIE_DOMAIN),
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },

    rateLimit: { enabled: false },

    trustedOrigins: getTrustedOrigins(),

    onAPIError: {
      onError: (error) => {
        if (isAPIError(error) && error.statusCode < 500) return;
        captureThrown(error, "better-auth");
      },
    },

    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        ...schema,
      },
    }),

    user: {
      additionalFields: {
        revision: { type: "number", required: true, defaultValue: 0, input: false },
        lastUsedCompanyId: { type: "string", required: false, input: false },
      },
    },

    emailAndPassword: {
      enabled: false,
    },

    socialProviders: {
      ...(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET
        ? {
            github: {
              clientId: process.env.AUTH_GITHUB_ID,
              clientSecret: process.env.AUTH_GITHUB_SECRET,
            },
          }
        : {}),
    },

    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          await runtime.runPromise(dispatchMagicLink(email, url));
        },
        expiresIn: MAGIC_LINK_EXPIRES_IN_SECONDS,
        storeToken: "hashed",
      }),
      primaryAuth(runtime),
      revokeOnlySessionTokens(),
    ],

    session: {
      cookieCache: {
        enabled: false,
      },
      freshAge: 0,
    },

    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: [],
      },
    },
  });
}

export let auth: ReturnType<typeof buildAuth>;

export function initAuth(runtime: AppRuntime): void {
  if (auth) return;
  auth = buildAuth(runtime);
}

export type Session = ReturnType<typeof buildAuth>["$Infer"]["Session"];
