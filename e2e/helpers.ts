import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";

// playwright は playwright.config.ts の位置 (repo root) を cwd に実行するため、そこ基準で解決する
// (import.meta.url は playwright の CJS transpile と衝突する)
const SERVER_LOG = join(process.cwd(), "e2e", ".server.log");
const BASE_URL = "http://localhost:3110";

// local 環境の sendMagicLink は console に `[TEST] Magic Link for <email>: <url>` を出す
// (src/auth.ts)。メール送信を実際に行わないため、e2e はこの行から verify URL を拾う。
export const magicLinkFor = async (email: string): Promise<string> => {
  const marker = `[TEST] Magic Link for ${email}: `;
  for (let attempt = 0; attempt < 50; attempt++) {
    const line = readFileSync(SERVER_LOG, "utf8")
      .split("\n")
      .filter((l) => l.includes(marker))
      .at(-1);
    if (line) return line.slice(line.indexOf(marker) + marker.length).trim();
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`magic link for ${email} not found in ${SERVER_LOG}`);
};

export const signInWithMagicLink = async (page: Page, email: string): Promise<void> => {
  await page.goto(
    `/auth/?service_name=accounts&redirect_url=${encodeURIComponent(`${BASE_URL}/account`)}`,
  );
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: "Magic Link を送信" }).click();
  await expect(page.getByText("を送信しました")).toBeVisible();

  await page.goto(await magicLinkFor(email));
};
