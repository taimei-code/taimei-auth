import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";

// playwright は playwright.config.ts の位置 (repo root) を cwd に実行するため、そこ基準で解決する
// (import.meta.url は playwright の CJS transpile と衝突する)
const SERVER_LOG = join(process.cwd(), "e2e", ".server.log");
export const BASE_URL = "http://localhost:3110";

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

export const signInWithMagicLink = async (page: Page, email: string): Promise<void> => {
  await page.goto(authEntryUrl());
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: "Magic Link を送信" }).click();
  await expect(page.getByText("を送信しました")).toBeVisible();

  await page.goto(await magicLinkFor(email));
};
