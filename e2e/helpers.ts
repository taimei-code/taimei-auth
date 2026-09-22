import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";

// import.meta.url は playwright の CJS transpile と衝突するため cwd (repo root) 起点で解決する
const SERVER_LOG = join(process.cwd(), "e2e", ".server.log");
const BASE_URL = "http://localhost:3110";

// name は fixtures.ts の consumableFixtures の key と揃える (import すると pg の Pool が spec プロセスに入り runner が hang する)
export const reseedFixture = (
  name: "leave" | "delete" | "delete-multi" | "invitation" | "mfa",
): void => {
  execFileSync("bun", ["run", join(process.cwd(), "e2e", "seed.ts"), name], { stdio: "inherit" });
};

export const authEntryUrl = (opts: { invitationToken?: string } = {}): string => {
  const url = new URL("/auth/", BASE_URL);
  url.searchParams.set("service_name", "accounts");
  url.searchParams.set("redirect_url", `${BASE_URL}/account`);
  if (opts.invitationToken !== undefined) {
    url.searchParams.set("invitation_token", opts.invitationToken);
  }
  return url.toString();
};

// marker は src/email/send-magic-link.ts と send-invitation.ts の console 出力と揃える
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

// web/src/auth/auth-redirect.ts の signInLandingUrl と揃える
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
