import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";

// playwright は playwright.config.ts の位置 (repo root) を cwd に実行するため、そこ基準で解決する
// (import.meta.url は playwright の CJS transpile と衝突する)
const SERVER_LOG = join(process.cwd(), "e2e", ".server.log");
export const BASE_URL = "http://localhost:3110";

// 消費型 fixture (spec 実行がアカウントごと消費する) を spec ごとに作り直し、CI retry と
// ローカル再実行 (reuseExistingServer で seed が走らない) に耐性を持たせる。
// DB 接触を spec プロセスへ持ち込まないため子プロセスで実行する — spec 側に pg Pool を
// 開くと閉じる手段が無く playwright runner が hang する。exit code 非 0 は execFileSync が
// throw するため、seed 側のガード・不整合はそのまま spec の失敗として表面化する。
// name の有効値の正本は fixtures.ts の consumableFixtures (値 import は DB を spec プロセスへ
// 持ち込むため、型も共有せず文字列 union をここで再宣言する)。
export const reseedFixture = (
  name: "leave" | "delete" | "delete-multi" | "invitation" | "mfa",
): void => {
  execFileSync("bun", ["run", join(process.cwd(), "e2e", "seed.ts"), name], { stdio: "inherit" });
};

// 共通ログイン画面の入口 URL。query の組立てを spec ごとに手書きすると service_name /
// redirect_url のキー名変更時に一部 spec だけ別 URL を叩くため、ここに集約する。
export const authEntryUrl = (opts: { invitationToken?: string } = {}): string => {
  const url = new URL("/auth/", BASE_URL);
  url.searchParams.set("service_name", "accounts");
  url.searchParams.set("redirect_url", `${BASE_URL}/account`);
  if (opts.invitationToken !== undefined) {
    url.searchParams.set("invitation_token", opts.invitationToken);
  }
  return url.toString();
};

// local 環境はメールを送らず console に verify URL を出す (src/email/send-magic-link.ts / send-invitation.ts)。
// 通常ログインは `[TEST] Magic Link for <email>: <url>`、招待文脈は
// `[TEST] Invitation email for <email>: <url>` と行が分かれるため両方を拾う。
export const magicLinkFor = async (email: string): Promise<string> => {
  const markers = [`[TEST] Magic Link for ${email}: `, `[TEST] Invitation email for ${email}: `];
  for (let attempt = 0; attempt < 50; attempt++) {
    const line = readFileSync(SERVER_LOG, "utf8")
      .split("\n")
      .filter((l) => markers.some((m) => l.includes(m)))
      .at(-1);
    if (line) {
      const marker = markers.find((m) => line.includes(m)) as string;
      return line.slice(line.indexOf(marker) + marker.length).trim();
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`magic link for ${email} not found in ${SERVER_LOG}`);
};

// アカウント連動削除 (ADR-0010) 後の着地契約。着地 URL の query キー名は
// web/src/auth/auth-redirect.ts の signInLandingUrl が正本のため、spec ごとに regex を
// 手書きすると正本変更時に一部 spec だけ古い契約で通り続ける。ここに集約する。
export const expectSignInLanding = async (page: Page): Promise<void> => {
  await expect(page).toHaveURL(/\/auth\?service_name=accounts/);
  await expect(page.getByRole("button", { name: "Magic Link を送信" })).toBeVisible();
};

export const signInWithMagicLink = async (page: Page, email: string): Promise<void> => {
  await page.goto(authEntryUrl());
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: "Magic Link を送信" }).click();
  await expect(page.getByText("を送信しました")).toBeVisible();

  await page.goto(await magicLinkFor(email));
};
