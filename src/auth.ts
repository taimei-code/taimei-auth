import { betterAuth, APIError } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { db } from "@/db/client";
import { findCompaniesBlockingUserDeletion } from "@/db/repositories/membership";
import * as schema from "@/db/schema";
import { mfaChallenge } from "./auth-plugins/mfa-challenge";
import { signInObserver } from "./auth-plugins/sign-in-observer";
import { getAppName } from "./email/client";
import { sendInvitationEmail } from "./email/send-invitation";
import { sendMagicLinkEmail } from "./email/send-magic-link";
import { resolveInvitationEmailContext } from "./invitation/resolve-email-context";
import { resolveCrossSubDomainCookies } from "./cookie-domain";
import { getTrustedOrigins, isBunRuntime, isLocalEnvironment } from "./env";
import { redisStorage } from "./redis";

const authCookieDomain = process.env.AUTH_COOKIE_DOMAIN;

// Workers は per-request env のため module ロード時でなく initAuth() で構築する
// (Workers は worker entry が initDb→initRedis→initAuth の順で呼ぶ)。詳細: ADR-0011
function buildAuth() {
  return betterAuth({
    baseURL: process.env.AUTH_SERVICE_URL,

    // 自前 MFA enroll の issuer 供給源 (src/mfa/totp/wiring.ts)。enroll と再表示で同じ issuer を
    // 使うことが認証アプリのエントリが割れない条件。
    appName: getAppName(),

    secondaryStorage: redisStorage,

    // local の Bun e2e のみ verification を DB にも保存 (postgres から token を取得するため)。
    // Workers は DB token 消費が hang する (ADR-0011) ため false にし secondaryStorage に保存する。
    verification: {
      storeInDatabase: isBunRuntime() && isLocalEnvironment(),
    },

    advanced: {
      useSecureCookies: !isLocalEnvironment(),
      crossSubDomainCookies: resolveCrossSubDomainCookies(authCookieDomain),
    },

    trustedOrigins: getTrustedOrigins(),

    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        ...schema,
      },
    }),

    user: {
      additionalFields: {
        // secondaryStorage payload に revision を含めるための宣言。実際の ++ は
        // drizzle/manual/0001_user_revision_triggers.sql の DB trigger に閉じる (input: false で client 不可)。
        revision: { type: "number", required: true, defaultValue: 0, input: false },
        // user の現在事業所。VerifySession が DB から fresh 読みして SDK SessionData.companyId に公開する。
        // input: false で書き換えを封じ、更新は CreateCompany / SetCurrentCompany handler 経由のみ。
        lastUsedCompanyId: { type: "string", required: false, input: false },
      },
      // SPA DangerZone (authClient.deleteUser) の経路 (PR #55 → #63)。beforeDelete で「唯一の OWNER の
      // ACTIVE 事業所が残っていないか」を検証し中断する (RPC DeleteUser handler と二重防御)。
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => {
          const blocking = await findCompaniesBlockingUserDeletion(user.id);
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

    // env 不揃い時は GitHub OAuth を無効化 (local では Magic Link を主導線にしてサーバ起動を妨げない)
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
          // callbackURL に invitation_token があれば事業所名 / 招待者を載せた招待メールを送る。
          const invitationContext = await resolveInvitationEmailContext(url);
          if (invitationContext) {
            await sendInvitationEmail({ inviteeEmail: email, url, ...invitationContext });
            return;
          }
          await sendMagicLinkEmail(email, url);
        },
        expiresIn: 300,
        // local は test 高速化で緩め、production は Hono middleware (src/rate-limit.ts) と独立した二重防御。
        rateLimit: isLocalEnvironment() ? { window: 1, max: 1000 } : { window: 60, max: 10 },
      }),
      // この 2 つは登録順が正しさの前提 (詳細: src/auth-plugins/sign-in-observer.ts)。
      mfaChallenge(),
      signInObserver(),
    ],

    session: {
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
      },
      // password を持たない構成のため sensitive 操作の再認証が不可能で、freshAge=0 にしないと退会が
      // 常に SESSION_NOT_FRESH で弾かれる。全 sensitive 操作の fresh 保護を切るので password 有効化時は再検討。
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

// ESM live binding: initAuth 後の値を import { auth } 側 (handler / rpc 群) が参照する。
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
