// fallow-ignore-file unused-file unused-export
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page, Route } from "@playwright/test";

import { BUILT_WEB_ENV } from "./build-web";

const ORIGIN = "https://auth.example.test";
const RP_ID = "auth.example.test";
const SECURITY_PATH = "/account/security";
const ASSETS_PREFIX = "/auth/assets/";
const FIVE_MINUTES_MS = 5 * 60 * 1000;

export type ListedPasskey = {
  id: string;
  created_at: string;
  last_used_at: string | null;
};

export type SecurityScreenScenario = {
  mfaEnabled?: boolean;
  passkeys?: ListedPasskey[];
  canRegister?: boolean;
  listFails?: boolean;
  registrationRejected?: boolean;
  ceremonyTimeoutMs?: number;
  withoutWebAuthn?: boolean;
  mfaAnsweredAfterPasskeyList?: boolean;
};

const COMPANY = {
  company_id: "company-a",
  company_name: "事業所A",
  company_org_code: "CORPORATE",
  role: "OWNER",
};

const builtWebDir = (): string => {
  const dir = process.env[BUILT_WEB_ENV];
  if (dir === undefined) {
    throw new Error(`${BUILT_WEB_ENV} が無い (playwright.config.ts の globalSetup が build する)`);
  }
  return dir;
};

const contentTypeOf = (path: string): string =>
  path.endsWith(".css") ? "text/css" : path.endsWith(".js") ? "text/javascript" : "text/html";

const registrationOptions = (timeout: number) => ({
  rp: { name: "taimei", id: RP_ID },
  user: { id: "dXNlci0x", name: "me@example.test", displayName: "me@example.test" },
  challenge: "Y2hhbGxlbmdlLWZvci1hY2NlcHRhbmNl",
  pubKeyCredParams: [
    { alg: -8, type: "public-key" },
    { alg: -7, type: "public-key" },
    { alg: -257, type: "public-key" },
  ],
  timeout,
  excludeCredentials: [],
  authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" },
  attestation: "none",
  extensions: { credProps: true },
});

const recordScreenFeedback = () => {
  const log: string[] = [];
  const snapshot = () =>
    [
      ...Array.from(document.querySelectorAll('[aria-label="通知"]'), (node) => node.textContent ?? ""),
      ...Array.from(document.querySelectorAll('[role="alert"]'), (node) => node.textContent ?? ""),
    ]
      .map((text) => text.trim())
      .filter((text) => text !== "")
      .join(" | ");
  const observe = () => {
    const current = snapshot();
    if (current !== "" && log.at(-1) !== current) {
      log.push(current);
    }
  };
  Object.assign(window, { __screenFeedback: log });
  new MutationObserver(observe).observe(document, {
    subtree: true,
    childList: true,
    characterData: true,
  });
};

const countSettledCreations = () => {
  const credentials = navigator.credentials;
  const create = credentials.create.bind(credentials);
  const state = { settled: 0 };
  Object.assign(window, { __settledCreations: state });
  credentials.create = (options) =>
    create(options).finally(() => {
      state.settled += 1;
    });
};

const removeWebAuthn = () => {
  Reflect.deleteProperty(window, "PublicKeyCredential");
};

type Fulfill = (route: Route) => Promise<void>;

const builtFile = (path: string) => {
  const file = join(builtWebDir(), path);
  return { body: readFileSync(file), contentType: contentTypeOf(file) };
};

export const openSecurityScreen = async (page: Page, scenario: SecurityScreenScenario = {}) => {
  const listed = [...(scenario.passkeys ?? [])];
  const registrations: unknown[] = [];
  const passkeyListServed = Promise.withResolvers<void>();
  const mfaEnabled = scenario.mfaEnabled === true;

  const api: Record<string, Fulfill> = {
    "GET /api/account/memberships": (route) =>
      route.fulfill({ json: { current_company_id: COMPANY.company_id, memberships: [COMPANY] } }),
    "GET /api/account/mfa": async (route) => {
      if (scenario.mfaAnsweredAfterPasskeyList === true) {
        await passkeyListServed.promise;
      }
      await route.fulfill({
        json: { enabled: mfaEnabled, recovery_codes_remaining: mfaEnabled ? 8 : 0 },
      });
    },
    "GET /api/account/passkeys": async (route) => {
      await route.fulfill(
        scenario.listFails === true
          ? { status: 429, json: { _tag: "RateLimited" } }
          : { json: { passkeys: listed, can_register: scenario.canRegister ?? true } },
      );
      passkeyListServed.resolve();
    },
    "POST /api/account/passkeys/registration-options": (route) =>
      route.fulfill({ json: registrationOptions(scenario.ceremonyTimeoutMs ?? FIVE_MINUTES_MS) }),
    "POST /api/account/passkeys": (route) => {
      registrations.push(route.request().postDataJSON());
      if (scenario.registrationRejected === true) {
        return route.fulfill({ status: 400, json: { _tag: "PasskeyRejected" } });
      }
      listed.push({
        id: `passkey-${listed.length + 1}`,
        created_at: new Date().toISOString(),
        last_used_at: null,
      });
      return route.fulfill({ json: { ok: true } });
    },
  };

  const answer = (route: Route): Promise<void> => {
    const { pathname } = new URL(route.request().url());
    if (pathname.startsWith(ASSETS_PREFIX)) {
      return route.fulfill(builtFile(join("assets", pathname.slice(ASSETS_PREFIX.length))));
    }
    if (!pathname.startsWith("/api/")) {
      return route.fulfill(builtFile("index.html"));
    }
    const endpoint = api[`${route.request().method()} ${pathname}`];
    return endpoint === undefined
      ? route.fulfill({ status: 404, json: { _tag: "NotFound" } })
      : endpoint(route);
  };

  await page.addInitScript(recordScreenFeedback);
  await page.addInitScript(scenario.withoutWebAuthn === true ? removeWebAuthn : countSettledCreations);
  await page.route(`${ORIGIN}/**`, answer);
  await page.goto(`${ORIGIN}${SECURITY_PATH}`);
  return { registrations: () => [...registrations] };
};

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
    verifyUser: (verified: boolean) =>
      cdp.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified: verified }),
  };
};

export const settledCreations = (page: Page): Promise<number> =>
  page.evaluate(
    () => (window as unknown as { __settledCreations: { settled: number } }).__settledCreations.settled,
  );

export const screenFeedback = (page: Page): Promise<string[]> =>
  page.evaluate(() => [...(window as unknown as { __screenFeedback: string[] }).__screenFeedback]);

export const securityRows = (page: Page): Locator => page.getByRole("main").getByRole("listitem");

export const mfaRow = (page: Page): Locator =>
  page.getByRole("main").getByRole("listitem").filter({ hasText: "多要素認証 (MFA)" });

export const passkeyRow = (page: Page): Locator =>
  page
    .getByRole("main")
    .getByRole("listitem")
    .filter({ has: page.getByText("パスキー", { exact: true }) });

export const passkeyItems = (page: Page): Locator => passkeyRow(page).getByRole("listitem");

export const registrationControl = (page: Page): Locator =>
  passkeyRow(page).getByRole("button", { name: /登録/ });
