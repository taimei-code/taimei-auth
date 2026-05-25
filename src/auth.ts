import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { render } from "@react-email/components";
import { db } from "@/db/client";
import { appendAuditLog } from "@/db/repositories/audit-log";
import * as schema from "@/db/schema";
import { sendWelcomeEmail } from "./email/send-welcome";
import { sendInvitationEmail } from "./email/send-invitation";
import { resolveInvitationEmailContext } from "./invitation/resolve-email-context";
import { getAppName, getMagicLinkFromEmail, getResendClient } from "./email/client";
import { isLocalEnvironment } from "./env";
import MagicLinkEmail from "./email/magic-link";
import { captureAuditLogError } from "./audit-error";
import { getClientContext } from "./request-context";
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

  user: {
    additionalFields: {
      // secondaryStorage payload に revision を含めるための宣言。
      // 実際の ++ は drizzle/manual/0001_user_revision_triggers.sql の DB trigger に閉じる。
      // input: false により API 経由の client からは書き換え不能。
      revision: { type: "number", required: true, defaultValue: 0, input: false },
      // ADR-009: user の現在事業所 (= last_used_company_id)。VerifySession が DB から fresh 読みして
      // proto User.default_company_id 経由で SDK SessionData.companyId に公開する。
      // input: false で API 経由の書き換えを封じ、更新は CreateCompany / SetCurrentCompany handler 経由のみ。
      lastUsedCompanyId: { type: "string", required: false, input: false },
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
        // ADR-009: callbackURL に invitation_token があれば、default ログインリンクではなく
        // 事業所名 / 招待者を載せた招待メールを送る (1-click 受諾 + custom 文面の両立)。
        const invitationContext = await resolveInvitationEmailContext(url);
        if (invitationContext) {
          await sendInvitationEmail({ inviteeEmail: email, url, ...invitationContext });
          return;
        }

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
        // 将来 provider 追加時に sign_in payload の method 型と分岐が乖離するのを防ぐため、
        // 識別不能なら audit append 自体を skip (else 固定の "github" 誤判定を避ける)。
        const method: "magic_link" | "github" | null =
          ctx.path === "/sign-in/magic-link"
            ? "magic_link"
            : ctx.path?.startsWith("/callback/github")
              ? "github"
              : null;
        if (method) {
          const { ip, userAgent } = getClientContext(ctx.headers);
          appendAuditLog({
            eventType: "sign_in",
            userId: newSession.user.id,
            payload: { method, ip, userAgent },
          }).catch((e) => captureAuditLogError("sign_in", e));
        }
      }
    }),
  },
});

export type Session = typeof auth.$Infer.Session;
