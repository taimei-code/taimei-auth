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

// 新規ユーザー判定の閾値（10秒以内に作成されたユーザーは新規登録）
const NEW_USER_THRESHOLD_MS = 10000;

const isJustSignedUp = (createdAt: Date): boolean =>
  Date.now() - createdAt.getTime() < NEW_USER_THRESHOLD_MS;

// 同じ env を 3 箇所で読むのを避けるため module 評価時に 1 回束縛する。
const authCookieDomain = process.env.AUTH_COOKIE_DOMAIN;

export const auth = betterAuth({
  baseURL: process.env.AUTH_SERVICE_URL,

  secondaryStorage: redisStorage,

  // secondaryStorage 有効時、Better Auth は verification を Redis のみに保存する。
  // e2e は postgres から token を取得して Magic Link verify を行うため、
  // local 環境 (test / development) のみ storeInDatabase=true で両方に書く
  // (production は Redis-only)。
  verification: {
    storeInDatabase: isLocalEnvironment(),
  },

  advanced: {
    useSecureCookies: !isLocalEnvironment(),
    // crossSubDomainCookies の有効化条件は AUTH_COOKIE_DOMAIN 値そのもので判定する:
    // - 未指定 / "localhost": disable (Set-Cookie の Domain=localhost を reject するブラウザ
    //   実装があるため。docker compose 単体起動の互換性確保)。
    // - それ以外 (.taimei-code.local のローカル開発統合, .taimei-code.com 本番): enable。
    //   AUTH_COOKIE_DOMAIN を明示設定したのは「subdomain 跨ぎで Cookie を共有したい」という
    //   ユーザー意思の表明であり、APP_ENV (development/production) と独立に判定するのが安全。
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

  // GitHub OAuth は env が両方揃っているときだけ有効化する。
  // local 環境では Magic Link を主導線とし、GitHub を使わなくてもサーバ起動を妨げないため。
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
    // nextCookies() は除去（Next.js 非依存）
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

        // setFlash は使わない（Next.js 依存）
        // 代わりにリダイレクト URL にクエリパラメータを付与し、
        // プロダクト側で受け取ってフラッシュメッセージを表示する
        // この処理は callbackURL にパラメータを追加する形で Better Auth の
        // リダイレクトハンドラーで対応（Phase 2 以降で実装）

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
