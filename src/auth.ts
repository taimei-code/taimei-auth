import { betterAuth, APIError } from "better-auth";
import { isAPIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { mfaChallenge } from "./auth-plugins/mfa-challenge";
import { signInObserver } from "./auth-plugins/sign-in-observer";
import { getAppName } from "./email/client";
import { dispatchMagicLink } from "./email/dispatch-magic-link";
import { resolveCrossSubDomainCookies } from "./cookie-domain";
import { getTrustedOrigins, isBunRuntime, isLocalEnvironment } from "./env";
import { captureThrown } from "./handlers/client-facing-error";
import { MembershipRepo } from "./membership/ports";
import { ttlStorage } from "./ttl-store";
import type { AppRuntime } from "./runtime";

const authCookieDomain = process.env.AUTH_COOKIE_DOMAIN;

// Workers では env が request ごとに渡されるため、module ロード時でなく initAuth() で構築する。
function buildAuth(runtime: AppRuntime) {
  return betterAuth({
    baseURL: process.env.AUTH_SERVICE_URL,

    // TOTP issuer になる。enroll と再表示で同じ値でないと認証アプリのエントリが分かれる。
    appName: getAppName(),

    secondaryStorage: ttlStorage,

    // Workers では DB の verification token の消費が hang するため、Bun のローカル実行だけ true にする。
    verification: {
      storeInDatabase: isBunRuntime() && isLocalEnvironment(),
    },

    advanced: {
      useSecureCookies: !isLocalEnvironment(),
      crossSubDomainCookies: resolveCrossSubDomainCookies(authCookieDomain),
    },

    trustedOrigins: getTrustedOrigins(),

    // better-auth の router は throw を捕捉して 500 にするため、Hono にも adapter にも届かない。
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
        // 加算は drizzle/manual/0001_user_revision_triggers.sql の trigger だけが行う。
        revision: { type: "number", required: true, defaultValue: 0, input: false },
        lastUsedCompanyId: { type: "string", required: false, input: false },
      },
      // SPA の DangerZone はこの経路を通る (RPC の DeleteUser と同じ防御を二重に置く)。
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => {
          const blocking = await runtime.runPromise(
            MembershipRepo.use((m) => m.findCompaniesBlockingUserDeletion(user.id)),
          );
          if (blocking.length > 0) {
            throw new APIError("PRECONDITION_FAILED", {
              code: "OWNER_OF_ACTIVE_COMPANY",
              message: `所有者として残っている事業所が ${blocking.length} 件あります。先に委譲または削除してください。`,
            });
          }
        },
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
        expiresIn: 300,
        // Hono middleware (rate-limit.ts) と独立した二重の防御。local はテストを速くするため緩める。
        rateLimit: isLocalEnvironment() ? { window: 1, max: 1000 } : { window: 60, max: 10 },
      }),
      mfaChallenge(runtime),
      signInObserver(runtime),
    ],

    session: {
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
      },
      // password が無いと再認証できず、退会が常に SESSION_NOT_FRESH になるため 0 にする。
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
