import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { render } from "@react-email/components";
import { db } from "@/db/client";
import { appendAuditLog } from "@/db/repositories/audit-log";
import * as schema from "@/db/schema";
import { sendWelcomeEmail } from "./email/send-welcome";
import { getAppName, getMagicLinkFromEmail, getResendClient } from "./email/client";
import { isLocalEnvironment } from "./env";
import MagicLinkEmail from "./email/magic-link";
import { redisStorage } from "./redis";
import { Sentry } from "./sentry";

const NEW_USER_THRESHOLD_MS = 10000;

const isJustSignedUp = (createdAt: Date): boolean =>
  Date.now() - createdAt.getTime() < NEW_USER_THRESHOLD_MS;

const authCookieDomain = process.env.AUTH_COOKIE_DOMAIN;

export const auth = betterAuth({
  baseURL: process.env.AUTH_SERVICE_URL,

  secondaryStorage: redisStorage,

  // local 環境のみ verification を DB にも保存 (e2e で postgres から token を取得するため)
  verification: {
    storeInDatabase: isLocalEnvironment(),
  },

  advanced: {
    useSecureCookies: !isLocalEnvironment(),
    // 判定基準は AUTH_COOKIE_DOMAIN 値そのもの (APP_ENV 非依存)。詳細: docs/adr/0004-cross-subdomain-cookie-rule.md
    crossSubDomainCookies: {
      enabled: !!authCookieDomain && authCookieDomain !== "localhost",
      domain: authCookieDomain || "taimei-code.com",
    },
  },

  trustedOrigins: (process.env.AUTH_TRUSTED_ORIGINS || "").split(",").filter(Boolean),

  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      ...schema,
    },
  }),

  user: {
    additionalFields: {
      // secondaryStorage payload に revision を含めるための宣言。
      // 実際の ++ は drizzle/manual/0001_user_revision_triggers.sql の DB trigger に閉じる。
      // input: false により API 経由の client からは書き換え不能。
      revision: { type: "number", required: true, defaultValue: 0, input: false },
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
        if (isLocalEnvironment()) {
          console.log(`[TEST] Magic Link for ${email}: ${url}`);
          return;
        }

        const resend = getResendClient();
        const fromEmail = getMagicLinkFromEmail();
        const appName = getAppName();

        const emailComponent = MagicLinkEmail({ url, appName });
        const html = await render(emailComponent);
        const text = await render(emailComponent, { plainText: true });

        const { error } = await resend.emails.send({
          from: fromEmail,
          to: email,
          subject: `${appName} へのログインリンク`,
          html,
          text,
        });

        if (error) {
          console.error("Failed to send magic link email:", error);
          throw new Error(`Email sending failed: ${error.message}`);
        }
      },
      expiresIn: 300,
      // local: 1000 req/s 許可 (test の高速化)。
      // production: Hono middleware (src/rate-limit.ts) と独立した二重防御として 10 req/min。
      rateLimit: isLocalEnvironment() ? { window: 1, max: 1000 } : { window: 60, max: 10 },
    }),
  ],

  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },

  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: [],
    },
  },

  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      const newSession = ctx.context.newSession;

      if (newSession) {
        const createdAt = new Date(newSession.user.createdAt);
        if (isJustSignedUp(createdAt)) {
          sendWelcomeEmail(newSession.user.email, newSession.user.name).catch((e) =>
            console.error("Welcome email failed:", e),
          );
        }

        // sign-out path は ctx.context.newSession を populate しないため (better-auth 1.6.9 仕様)、
        // sign-out audit は handler 側で取る。ここは sign-in 経路のみ通る。
        const method = ctx.path.includes("/sign-in/magic-link") ? "magic_link" : "github";
        const ip =
          ctx.headers?.get("x-forwarded-for")?.split(",")[0].trim() ||
          ctx.headers?.get("x-real-ip") ||
          "unknown";
        const userAgent = ctx.headers?.get("user-agent") || "unknown";
        appendAuditLog({
          eventType: "sign_in",
          userId: newSession.user.id,
          payload: { method, ip, userAgent },
        }).catch((e) => {
          Sentry.captureException(e, { tags: { component: "audit-log", event: "sign_in" } });
        });
      }
    }),
  },
});

export type Session = typeof auth.$Infer.Session;
