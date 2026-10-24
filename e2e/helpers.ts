import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { sentLinkIn } from "../src/email/local-delivery-log";
import { SIGN_IN_LANDING_PATH } from "../web/src/shared/leave-spa";
import { TESTING_PATH } from "@taimei-code/auth-client/testing";
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

export const sentLinkAfter = async (
  email: string,
  send: () => Promise<unknown>,
): Promise<string> => {
  const logSizeBeforeSend = statSync(SERVER_LOG).size;
  await send();
  for (let attempt = 0; attempt < 50; attempt++) {
    const lines = readFileSync(SERVER_LOG).subarray(logSizeBeforeSend).toString("utf8").split("\n");
    const link = sentLinkIn(lines, email);
    if (link) return link;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `no email to ${email} was logged in ${SERVER_LOG} after byte ${logSizeBeforeSend}`,
  );
};

export const expectSignInLanding = async (page: Page): Promise<void> => {
  await expect(page).toHaveURL((url) =>
    `${url.pathname}${url.search}`.startsWith(SIGN_IN_LANDING_PATH),
  );
  await expect(page.getByRole("button", { name: "Magic Link を送信" })).toBeVisible();
};

export const signInWithMagicLink = async (page: Page, email: string): Promise<string> => {
  const response = await page.request.post(`${BASE_URL}${TESTING_PATH}/login-links`, {
    data: { email, returnTo: `${BASE_URL}/account` },
  });
  expect(response.status()).toBe(200);
  const { loginUrl } = (await response.json()) as { loginUrl: string };
  await page.goto(loginUrl);
  return loginUrl;
};

export const signInThroughMagicLinkForm = async (page: Page, email: string): Promise<string> => {
  await page.goto(authEntryUrl());
  await page.getByPlaceholder("you@example.com").fill(email);
  const link = await sentLinkAfter(email, async () => {
    await page.getByRole("button", { name: "Magic Link を送信" }).click();
    await expect(page.getByText("を送信しました")).toBeVisible();
  });
  await page.goto(link);
  return link;
};
