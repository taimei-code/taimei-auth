import { execFileSync } from "node:child_process";
import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { type APIRequestContext, expect, type Locator, type Page } from "@playwright/test";
import { TESTING_PATH } from "@taimei-code/auth-client/testing";
import {
  TOTP_DIGITS,
  TOTP_PERIOD_SECONDS,
  TOTP_WINDOW_STEPS,
} from "../src/mfa/totp/totp-parameters";
import { sentLinkIn } from "../testing/local-delivery-log";
import { SIGN_IN_LANDING_PATH } from "../web/src/shared/landing-paths";
import { routeEndpoint } from "./contract-mock";
import type { ConsumableFixture } from "./fixture-names";

const REPO_ROOT = join(__dirname, "..");
const SERVER_LOG = join(__dirname, ".server.log");
export const BASE_URL = "http://localhost:3110";

export const SWITCH_EMAIL = "e2e-switch@example.com";

export const MFA_EMAIL = "e2e-mfa@example.com";

export const PASSKEY_EMAIL = "e2e-passkey@example.com";

export const addVirtualAuthenticator = async (
  page: Page,
  { userVerified = true, presence = true }: { userVerified?: boolean; presence?: boolean } = {},
) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: userVerified,
      automaticPresenceSimulation: presence,
    },
  });
  return {
    verifyUser: () =>
      cdp.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified: true }),
    refuseUser: () =>
      cdp.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified: false }),
  };
};

export const passkeySignInEntryShown = async (request: APIRequestContext) =>
  (
    (await (await request.get("/api/passkey/sign-in/availability")).json()) as {
      available: boolean;
    }
  ).available;

export const featureFlags = (request: APIRequestContext) => {
  const send = async (data: { flag: string; state: string; companyIds?: readonly string[] }) => {
    const response = await request.post(`${TESTING_PATH}/feature-flags`, { data });
    expect(response.status()).toBe(200);
  };
  return {
    on: (flag: string) => send({ flag, state: "on" }),
    off: (flag: string) => send({ flag, state: "off" }),
    onlyFor: (flag: string, companyIds: readonly string[]) =>
      send({ flag, state: "onlyFor", companyIds }),
  };
};

export const mfaRow = (page: Page) =>
  page.getByRole("main").getByRole("listitem").filter({ hasText: "多要素認証 (MFA)" });

export const securityRows = (page: Page) => page.getByRole("main").getByRole("listitem");

export const passkeyRow = (page: Page) =>
  securityRows(page).filter({ hasText: "指紋・顔認証・PIN でログインできます" });

export const passkeyItems = (page: Page) => passkeyRow(page).getByRole("listitem");

export const registerPasskeyButton = (page: Page) =>
  passkeyRow(page).getByRole("button", { name: "登録する" });

export const companySwitcher = (page: Page) =>
  page.getByRole("combobox", { name: "事業所を切り替え" });

export const reseedFixture = (name: ConsumableFixture): void => {
  execFileSync("bun", ["run", join(__dirname, "seed.ts"), name], {
    stdio: "inherit",
    cwd: REPO_ROOT,
  });
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

export const signInWithMagicLink = async (
  page: Page,
  email: string,
  returnTo = `${BASE_URL}/account`,
): Promise<string> => {
  const response = await page.request.post(`${BASE_URL}${TESTING_PATH}/login-links`, {
    data: { email, returnTo },
  });
  expect(response.status()).toBe(200);
  const { loginUrl } = (await response.json()) as { loginUrl: string };
  await page.goto(loginUrl);
  return loginUrl;
};

export const agePastReauthenticationWindow = async (page: Page): Promise<void> => {
  const response = await page.request.post(`${BASE_URL}${TESTING_PATH}/session-age`, {
    headers: { origin: new URL(BASE_URL).origin },
    data: { issuedSecondsAgo: 10 * 60 + 1 },
  });
  expect(response.status()).toBe(204);
};

export const signInAgainReturningToSecurity = async (page: Page, email: string): Promise<void> => {
  await expect(page).toHaveURL(/\/auth\/reauthenticate\?/);
  const returnTo = new URL(page.url()).searchParams.get("redirect_url") ?? "";
  expect(returnTo).toBe(new URL("/account/security", page.url()).toString());
  await signInWithMagicLink(page, email, returnTo);
  await expect(page).toHaveURL(/\/account\/security$/);
};

export const sendMagicLinkFromForm = async (page: Page, email: string): Promise<string> => {
  await page.getByPlaceholder("you@example.com").fill(email);
  return sentLinkAfter(email, async () => {
    await page.getByRole("button", { name: "Magic Link を送信" }).click();
    await expect(page.getByText("を送信しました")).toBeVisible();
  });
};

export const signInThroughMagicLinkForm = async (page: Page, email: string): Promise<string> => {
  await page.goto(authEntryUrl());
  const link = await sendMagicLinkFromForm(page, email);
  await page.goto(link);
  return link;
};

export type ListedPasskey = {
  id: string;
  created_at: string;
  last_used_at: string | null;
  provider_name: string | null;
};

export const openSecurityListing = async (
  page: Page,
  passkeys: ReadonlyArray<ListedPasskey>,
  { canRegister = true }: { canRegister?: boolean } = {},
) => {
  const listed = { passkeys };
  await routeEndpoint(page, "passkey.list", (route) =>
    route.fulfill({ json: { passkeys: listed.passkeys, can_register: canRegister } }),
  );
  await signInWithMagicLink(page, PASSKEY_EMAIL);
  await page.goto("/account/security");
  await expect(passkeyItems(page)).toHaveCount(passkeys.length);
  return listed;
};

export const acceptPasskeyDeletions = (
  page: Page,
  listed: { passkeys: ReadonlyArray<ListedPasskey> },
) =>
  routeEndpoint(page, "passkey.delete", async (route) => {
    const deletedId = new URL(route.request().url()).pathname.split("/").at(-2);
    listed.passkeys = listed.passkeys.filter((passkey) => passkey.id !== deletedId);
    await route.fulfill({ json: { ok: true } });
  });

export const confirmationDialog = (page: Page) => page.getByRole("dialog");

export const confirmDeletionButton = (page: Page) =>
  confirmationDialog(page).getByRole("button", { name: /削除/ });

export const openConfirmationOf = async (page: Page, item: Locator) => {
  const deleteButton = item.getByRole("button", { name: /削除/ });
  await expect(deleteButton).toBeVisible();
  await deleteButton.click();
  await expect(confirmationDialog(page)).toBeVisible();
};

export const confirmDeletionOf = async (page: Page, item: Locator) => {
  await openConfirmationOf(page, item);
  await confirmDeletionButton(page).click();
};

export const decodeTotpSecret = (encoded: string): string =>
  new TextDecoder().decode(base32.decode(encoded));

const secretFromTotpUri = (totpUri: string): string => {
  const encoded = new URL(totpUri).searchParams.get("secret");
  if (!encoded) throw new Error(`otpauth URI に secret が無い: ${totpUri}`);
  return decodeTotpSecret(encoded);
};

export const totpCode = (secret: string, stepOffset = 0): Promise<string> => {
  const otp = createOTP(secret, { period: TOTP_PERIOD_SECONDS, digits: TOTP_DIGITS });
  if (stepOffset === 0) return otp.totp();
  return otp.hotp(Math.floor(Date.now() / (TOTP_PERIOD_SECONDS * 1000)) + stepOffset);
};

export const wrongTotpCode = async (secret: string): Promise<string> => {
  const acceptedOffsets = Array.from(
    { length: TOTP_WINDOW_STEPS * 2 + 1 },
    (_, i) => i - TOTP_WINDOW_STEPS,
  );
  const accepted = await Promise.all(acceptedOffsets.map((offset) => totpCode(secret, offset)));
  for (let candidate = 0; candidate < 1000; candidate++) {
    const code = String(candidate).padStart(TOTP_DIGITS, "0");
    if (!accepted.includes(code)) return code;
  }
  throw new Error("検証窓の外にある誤コードを作れなかった");
};

const PREVIOUS_STEP_LEAVING_CURRENT_UNUSED = -1;

type EnabledMfa = { secret: string; recoveryCodes: string[] };

export const enableMfaViaApi = async (page: Page): Promise<EnabledMfa> => {
  const enrolled = await page.request.post("/api/account/mfa/enroll", {
    headers: { "content-type": "application/json" },
  });
  expect(enrolled.status()).toBe(200);
  const enrollment = (await enrolled.json()) as {
    totp_uri: string;
    recovery_codes: string[];
    enrollment_id: string;
  };

  const secret = secretFromTotpUri(enrollment.totp_uri);
  const activated = await page.request.post("/api/account/mfa/activate", {
    data: {
      code: await totpCode(secret, PREVIOUS_STEP_LEAVING_CURRENT_UNUSED),
      enrollment_id: enrollment.enrollment_id,
    },
  });
  expect(activated.status()).toBe(200);

  return { secret, recoveryCodes: enrollment.recovery_codes };
};
