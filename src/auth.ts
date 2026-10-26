import { MAGIC_LINK_EXPIRES_IN_SECONDS } from "@taimei-code/auth-client";
import { betterAuth } from "better-auth";
import { isAPIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { primaryAuth } from "./auth-plugins/primary-auth";
import { getAppName } from "./email/client";
import { dispatchMagicLink } from "./email/dispatch-magic-link";
import { resolveCrossSubDomainCookies } from "./cookie-domain";
import { getTrustedOrigins } from "./env";
import { captureThrown } from "./handlers/client-facing-error";
import type { TtlStorage } from "./ttl-store";
import type { AppRuntime } from "./runtime";

const authCookieDomain = process.env.AUTH_COOKIE_DOMAIN;

function buildAuth(runtime: AppRuntime, ttlStorage: TtlStorage) {
  return betterAuth({
    baseURL: process.env.AUTH_SERVICE_URL,

    appName: getAppName(),

    secondaryStorage: ttlStorage,

    advanced: {
      useSecureCookies: true,
      crossSubDomainCookies: resolveCrossSubDomainCookies(authCookieDomain),
    },

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
        rateLimit: { window: 60, max: 10 },
      }),
      primaryAuth(runtime),
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

export function initAuth(runtime: AppRuntime, ttlStorage: TtlStorage): void {
  if (auth) return;
  auth = buildAuth(runtime, ttlStorage);
}

export type Session = ReturnType<typeof buildAuth>["$Infer"]["Session"];
