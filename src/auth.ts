import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { render } from "@react-email/components";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import { sendWelcomeEmail } from "./email/send-welcome";
import {
  getResendClient,
  getMagicLinkFromEmail,
  getAppName,
  isLocalEnvironment,
} from "./email/client";
import MagicLinkEmail from "./email/magic-link";
import { redisStorage } from "./redis";

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
      rateLimit: isLocalEnvironment() ? { window: 1, max: 1000 } : undefined,
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
      }
    }),
  },
});

export type Session = typeof auth.$Infer.Session;
