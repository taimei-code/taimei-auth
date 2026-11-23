import { expect, type Page, test } from "@playwright/test";
import {
  featureFlags,
  passkeySignInEntryShown,
  reseedFixture,
  SWITCH_EMAIL,
  signInWithMagicLink,
} from "./helpers";

const PASSKEY = "passkey";

const decisionsSeenBy = async (page: Page) => {
  const listed = (await (await page.request.get("/api/account/passkeys")).json()) as {
    can_register: boolean;
  };
  return {
    canRegister: listed.can_register,
    signInEntryShown: await passkeySignInEntryShown(page.request),
  };
};

test.beforeEach(() => reseedFixture("switch"));

test.afterEach(({ request }) => featureFlags(request).on(PASSKEY));

test("全体 on・事業所のリストだけ・全体 off を作ると、登録の可否と共通ログイン画面のパスキーの入口は全体 on の時だけ開く", async ({
  page,
}) => {
  await signInWithMagicLink(page, SWITCH_EMAIL);
  const { current_company_id: current } = (await (
    await page.request.get("/api/account/memberships")
  ).json()) as { current_company_id: string };

  await featureFlags(page.request).on(PASSKEY);
  expect(await decisionsSeenBy(page)).toEqual({ canRegister: true, signInEntryShown: true });

  await featureFlags(page.request).onlyFor(PASSKEY, [current]);
  expect(await decisionsSeenBy(page)).toEqual({ canRegister: false, signInEntryShown: false });

  await featureFlags(page.request).off(PASSKEY);
  expect(await decisionsSeenBy(page)).toEqual({ canRegister: false, signInEntryShown: false });
});
