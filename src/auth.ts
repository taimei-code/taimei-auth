import { betterAuth, APIError } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { db } from "@/db/client";
import { appendAuditLog } from "@/db/repositories/audit-log";
import { findCompaniesBlockingUserDeletion } from "@/db/repositories/membership";
import * as schema from "@/db/schema";
import { sendWelcomeEmail } from "./email/send-welcome";
import { sendInvitationEmail } from "./email/send-invitation";
import { resolveInvitationEmailContext } from "./invitation/resolve-email-context";
import { getAppName, getMagicLinkFromEmail, getResendClient } from "./email/client";
import { resolveCrossSubDomainCookies } from "./cookie-domain";
import { isBunRuntime, isLocalEnvironment } from "./env";
import MagicLinkEmail from "./email/magic-link";
import { captureAuditLogError } from "./audit-error";
import { getClientContext } from "./request-context";
import { redisStorage } from "./redis";
import { runBackground } from "./background";

const NEW_USER_THRESHOLD_MS = 10000;

const isJustSignedUp = (createdAt: Date): boolean =>
  Date.now() - createdAt.getTime() < NEW_USER_THRESHOLD_MS;

const authCookieDomain = process.env.AUTH_COOKIE_DOMAIN;

// Workers は per-request env のため、better-auth インスタンスを module ロード時ではなく
// initAuth() で構築する。buildAuth は db / redisStorage が init 済みの前提で呼ぶ
// (Bun は module ロード順で自動 init 済み、Workers は worker entry が initDb→initRedis→initAuth)。
// 設計詳細: docs/adr/0011-cloudflare-workers-migration.md
function buildAuth() {
  return betterAuth({
    baseURL: process.env.AUTH_SERVICE_URL,

    secondaryStorage: redisStorage,

    // local の Bun e2e のみ verification を DB にも保存 (postgres から token を取得するため)。
    // Workers では DB verification 消費が hang する (ADR-0011: better-auth の DB token 消費が
    // workerd/Hyperdrive 経路で完走しない) ため false にし、本番同様 secondaryStorage に保存する。
    verification: {
      storeInDatabase: isBunRuntime() && isLocalEnvironment(),
    },

    advanced: {
      useSecureCookies: !isLocalEnvironment(),
      crossSubDomainCookies: resolveCrossSubDomainCookies(authCookieDomain),
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
      // ADR-009 Q24: SPA DangerZone (authClient.deleteUser) の経路。
      // beforeDelete で「唯一の OWNER の ACTIVE 事業所が残っていないか」を検証し、
      // 残っていれば APIError で退会を中断する (RPC DeleteUser handler と二重防御)。
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
          // render は workerd バンドルで esbuild の lazy CJS init が re-export 経由で走らず
          // undefined ("render2 is not a function") になる。dynamic import で実行時に module
          // init を強制する。詳細: docs/adr/0011-cloudflare-workers-migration.md
          const { render } = await import("@react-email/components");
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
      // Magic Link / OAuth のみで password を持たず、delete-user 等の sensitive 操作で
      // 再認証 (password 再入力) ができない。freshAge=0 で fresh セッション要求を無効化し、
      // 退会が常に SESSION_NOT_FRESH で弾かれるのを防ぐ (DangerZone は再認証 step なしの設計)。
      // freshAge=0 は全 sensitive 操作の fresh 保護を無効化するグローバル設定のため、将来
      // emailAndPassword / changeEmail / changePassword を有効化する際は freshAge 再有効化を
      // 検討すること (password 認証ありなら fresh 再認証が機能するため)。
      freshAge: 0,
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
            // Workers では fire-and-forget を waitUntil 経由にしないと "hung" になる (background.ts)。
            runBackground(
              sendWelcomeEmail(newSession.user.email, newSession.user.name).catch((e) =>
                console.error("Welcome email failed:", e),
              ),
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
            runBackground(
              appendAuditLog({
                eventType: "sign_in",
                userId: newSession.user.id,
                payload: { method, ip, userAgent },
              }).catch((e) => captureAuditLogError("sign_in", e)),
            );
          }
        }
      }),
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

// Bun / Node: db / redisStorage は import 時に自動 init 済みのため auth も自動 init。
// Workers では Bun global が無いため skip し、worker entry が initDb→initRedis→initAuth を呼ぶ。
if (isBunRuntime()) {
  initAuth();
}
