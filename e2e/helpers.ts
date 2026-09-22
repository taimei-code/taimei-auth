import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";

// playwright は playwright.config.ts の位置 (repo root) を cwd として実行するため、そこを基準に解決する
// (import.meta.url は playwright の CJS への transpile と衝突する)
const SERVER_LOG = join(process.cwd(), "e2e", ".server.log");
const BASE_URL = "http://localhost:3110";

// 消費型 fixture (spec の実行がアカウントごと消費する) を spec ごとに作り直し、CI の retry と
// ローカルでの再実行 (reuseExistingServer で seed が走らない) に耐えられるようにする。
// DB への接続を spec のプロセスへ持ち込まないため、子プロセスで実行する。spec 側で pg の Pool を
// 開くと閉じる手段が無く、playwright の runner が hang する。exit code が 0 以外なら execFileSync が
// throw するため、seed 側のガードや不整合はそのまま spec の失敗として表面化する。
// name の有効な値は fixtures.ts の consumableFixtures で定義する (値を import すると DB を spec のプロセスへ
// 持ち込むため、型も共有せず文字列の union をここで再宣言する)。
export const reseedFixture = (
  name: "leave" | "delete" | "delete-multi" | "invitation" | "mfa",
): void => {
  execFileSync("bun", ["run", join(process.cwd(), "e2e", "seed.ts"), name], { stdio: "inherit" });
};

// 共通ログイン画面の入口 URL。query の組み立てを spec ごとに手書きすると、service_name や
// redirect_url のキー名を変えた時に一部の spec だけ別の URL を開いてしまうため、ここに集約する。
export const authEntryUrl = (opts: { invitationToken?: string } = {}): string => {
  const url = new URL("/auth/", BASE_URL);
  url.searchParams.set("service_name", "accounts");
  url.searchParams.set("redirect_url", `${BASE_URL}/account`);
  if (opts.invitationToken !== undefined) {
    url.searchParams.set("invitation_token", opts.invitationToken);
  }
  return url.toString();
};

// local 環境ではメールを送らず、console に verify URL を出す (src/email/send-magic-link.ts と send-invitation.ts)。
// 通常のログインは `[TEST] Magic Link for <email>: <url>`、招待の文脈では
// `[TEST] Invitation email for <email>: <url>` と行が分かれるため、両方を拾う。
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

// アカウント連動削除 (ADR-0010) の後の着地の契約。着地 URL の query のキー名は
// web/src/auth/auth-redirect.ts の signInLandingUrl で定義するため、spec ごとに regex を
// 手書きすると定義を変えた時に一部の spec だけ古い契約で通り続ける。そのためここに集約する。
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
