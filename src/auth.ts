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
import { captureThrown } from "./handlers/wire-error";
import { MembershipRepo } from "./membership/ports";
import { redisStorage } from "./redis";

const authCookieDomain = process.env.AUTH_COOKIE_DOMAIN;

// Workers は per-request env のため module ロード時でなく initAuth() で構築する。
function buildAuth() {
  return betterAuth({
    baseURL: process.env.AUTH_SERVICE_URL,

    // appName は MFA の TOTP issuer。enroll と再表示で同じ値でないと認証アプリのエントリが割れる。
    appName: getAppName(),

    secondaryStorage: redisStorage,

    // Workers は DB の verification token 消費が hang するため Bun の local 実行 (bun test / bun run dev) だけ true にする。
    verification: {
      storeInDatabase: isBunRuntime() && isLocalEnvironment(),
    },

    advanced: {
      useSecureCookies: !isLocalEnvironment(),
      crossSubDomainCookies: resolveCrossSubDomainCookies(authCookieDomain),
    },

    trustedOrigins: getTrustedOrigins(),

    // better-auth の router は processRequest 内の throw を握って 500 にし Hono にも adapter にも届かない。
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
        // ++ は drizzle/manual/0001_user_revision_triggers.sql の DB trigger に閉じる (ここは宣言のみ)。
        revision: { type: "number", required: true, defaultValue: 0, input: false },
        lastUsedCompanyId: { type: "string", required: false, input: false },
      },
      // RPC の DeleteUser handler と二重防御 (SPA DangerZone は better-auth のこの経路を通る)。
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => {
          // runtime は AuthApiLive 経由で本 module を import するため、循環を避けて呼び出し時に読み込む。
          const { getRuntime } = await import("./runtime");
          const blocking = await getRuntime().runPromise(
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
          // runtime → auth-service → auth の import 環を避けるため関数内で lazy import する。
          const { getRuntime } = await import("./runtime");
          await getRuntime().runPromise(dispatchMagicLink(email, url));
        },
        expiresIn: 300,
        // local は test 高速化で緩め、production は Hono middleware (src/rate-limit.ts) と独立した二重防御。
        rateLimit: isLocalEnvironment() ? { window: 1, max: 1000 } : { window: 60, max: 10 },
      }),
      mfaChallenge(),
      signInObserver(),
    ],

    session: {
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
      },
      // password 無しでは再認証できず退会が常に SESSION_NOT_FRESH になるため 0。password 有効化時は再検討。
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

export function initAuth(): void {
  if (auth) return;
  auth = buildAuth();
}

export type Session = ReturnType<typeof buildAuth>["$Infer"]["Session"];

// Bun / Node は import 時に db / redisStorage が init 済みのため auth も自動 init (Workers は worker entry)。
if (isBunRuntime()) {
  initAuth();
}
