import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { invitationLogPrefix, magicLinkLogPrefix } from "../src/email/local-delivery-log";
import { SIGN_IN_LANDING_PATH } from "../web/src/auth/auth-redirect";
import type { ConsumableFixture } from "./fixture-names";

const SERVER_LOG = join(process.cwd(), "e2e", ".server.log");
export const BASE_URL = "http://localhost:3110";

export const SWITCH_EMAIL = "e2e-switch@example.com";

export const companySwitcher = (page: Page) =>
  page.getByRole("combobox", { name: "事業所を切り替え" });

export const reseedFixture = (name: ConsumableFixture): void => {
  execFileSync("bun", ["run", join(process.cwd(), "e2e", "seed.ts"), name], { stdio: "inherit" });
};

export const watchMainFrameNavigations = (page: Page): { count: () => number } => {
  let count = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) count++;
  });
  return { count: () => count };
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

export const magicLinkFor = async (email: string): Promise<string> => {
  const markers = [magicLinkLogPrefix(email), invitationLogPrefix(email)];
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

export const expectSignInLanding = async (page: Page): Promise<void> => {
  await expect(page).toHaveURL((url) =>
    `${url.pathname}${url.search}`.startsWith(SIGN_IN_LANDING_PATH),
  );
  await expect(page.getByRole("button", { name: "Magic Link を送信" })).toBeVisible();
};

export const signInWithMagicLink = async (page: Page, email: string): Promise<void> => {
  await page.goto(authEntryUrl());
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByRole("button", { name: "Magic Link を送信" }).click();
  await expect(page.getByText("を送信しました")).toBeVisible();

  await page.goto(await magicLinkFor(email));
};
