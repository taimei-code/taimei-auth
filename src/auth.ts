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

// Workers は per-request env のため module ロード時でなく initAuth() で構築する
// (Workers は worker entry が initRedis→initAuth の順で呼び、実 Pool は request ごとに供給する)。詳細: ADR-0011
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

    // better-auth の router は processRequest 内の throw を握って 500 にし Hono にも adapter にも届かない
    // (dist/api/index.mjs の onError)。ここに来るのは hook / endpoint / middleware の非 APIError の throw と、router
    // middleware (originCheck) の APIError。endpoint 内で throw した APIError は 5xx でも dispatch が Response に変換して
    // 来ない。onRequest 段 (rate limiter) の throw は auth.handler の reject になるため src/app.ts の mount が拾う。
    // 4xx の APIError は意図した wire failure。戻りは await されないので同期で完結させ runtime は引かない。
    // throw: true は Hono 既定の 500 になるだけで Sentry に届かず Set-Cookie 合流も失う。
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
          // better-auth の callback は Promise / throw 規約の境界。判定は runtime で走らせ、結果を APIError に戻す。
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
          // better-auth callback は throw 契約 (ADR-0017 の物理境界)。runtime は import 環
          // (runtime → auth-service → auth) を避けるため関数内で lazy import する。
          const { getRuntime } = await import("./runtime");
          await getRuntime().runPromise(dispatchMagicLink(email, url));
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
