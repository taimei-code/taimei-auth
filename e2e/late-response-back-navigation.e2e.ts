import { expect, type Page, test } from "@playwright/test";
import { endpointPattern, routeEndpoint } from "./contract-mock";
import {
  BASE_URL,
  companySwitcher,
  reseedFixture,
  signInWithMagicLink,
  SWITCH_EMAIL,
} from "./helpers";

const PROFILE_URL = `${BASE_URL}/account`;
const COMPANIES_URL = `${BASE_URL}/account/companies`;
const DELETED_COMPANY = "e2e-co-delete-multi-current";
const REMAINING_COMPANY = "e2e-co-delete-multi-other";
const ADDED_COMPANY = "e2e-co-switch-added";

const frame = (page: Page) => page.getByRole("complementary");

type HeldResponse = { requested: Promise<void>; release: () => Promise<void> };

const holdResponse = async (page: Page, endpoint: string): Promise<HeldResponse> => {
  let open = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  let arrive = () => {};
  const requested = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  await routeEndpoint(
    page,
    endpoint,
    async (route) => {
      arrive();
      await opened;
      await route.continue();
    },
    { times: 1 },
  );
  return {
    requested,
    release: async () => {
      const answered = page.waitForResponse(endpointPattern(endpoint));
      open();
      await answered;
    },
  };
};

const enterFromProfile = async (page: Page, email: string, sidebarLink: string) => {
  await signInWithMagicLink(page, email);
  await expect(page).toHaveURL(PROFILE_URL);
  await page.getByRole("link", { name: sidebarLink }).click();
};

const goBackToProfileWhileWaiting = async (page: Page, held: HeldResponse) => {
  await held.requested;
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(PROFILE_URL);
};

const deleteCompanyHeld = async (page: Page): Promise<HeldResponse> => {
  reseedFixture("delete-multi");
  await enterFromProfile(page, "e2e-delete-multi@example.com", "事業所設定");
  await expect(page.getByLabel("事業所名")).toHaveValue(DELETED_COMPANY);
  const held = await holdResponse(page, "company.delete");
  await page.getByRole("button", { name: "削除する" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "削除する" }).click();
  return held;
};

const addCompanyHeld = async (page: Page): Promise<HeldResponse> => {
  reseedFixture("switch");
  await enterFromProfile(page, SWITCH_EMAIL, "所属事業所");
  const held = await holdResponse(page, "company.add");
  await page.getByRole("button", { name: "事業所を追加" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("事業所名").fill(ADDED_COMPANY);
  await dialog.getByRole("button", { name: "作成する" }).click();
  return held;
};

const expectFrameShowsOnlyRemainingCompany = async (page: Page) => {
  await expect(frame(page).getByText(REMAINING_COMPANY)).toBeVisible();
  await expect(frame(page).getByText(DELETED_COMPANY)).toHaveCount(0);
};

test("事業所の削除の応答を待つ間に「戻る」で別の page へ移り、応答が届くと、枠の現在の事業所が残った事業所になる", async ({
  page,
}) => {
  const held = await deleteCompanyHeld(page);
  await goBackToProfileWhileWaiting(page, held);
  await held.release();

  await expectFrameShowsOnlyRemainingCompany(page);
});

test("事業所の追加の応答を待つ間に「戻る」で別の page へ移り、応答が届くと、枠の現在の事業所が追加した事業所になる", async ({
  page,
}) => {
  const held = await addCompanyHeld(page);
  await goBackToProfileWhileWaiting(page, held);
  await held.release();

  await expect(companySwitcher(page).locator("option:checked")).toHaveText(ADDED_COMPANY);
});

test("オーナーの委譲の応答を待つ間に「戻る」で別の page へ移り、応答が届くと、枠の役割が管理者になる", async ({
  page,
}) => {
  reseedFixture("switch");
  await enterFromProfile(page, SWITCH_EMAIL, "所属事業所");
  await expect(frame(page).getByText(/・ オーナー$/)).toBeVisible();

  const soleOwnerCompany = page
    .getByRole("main")
    .locator("div.rounded-md.border")
    .filter({ hasText: "e2e-co-switch-a" });
  await soleOwnerCompany.getByRole("button", { name: "抜ける" }).click();
  await soleOwnerCompany.getByRole("button", { name: "オーナーを委譲" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("E2E SwitchAMate")).toBeVisible();
  const held = await holdResponse(page, "membership.transferOwnership");
  await dialog.getByRole("button", { name: "委譲" }).click();
  await goBackToProfileWhileWaiting(page, held);
  await held.release();

  await expect(frame(page).getByText(/・ 管理者$/)).toBeVisible();
});

test("事業所の削除の応答を待つ間に「戻る」で移った後に応答が届いても、行き先は変わらず、削除の通知は出ない", async ({
  page,
}) => {
  const held = await deleteCompanyHeld(page);
  await goBackToProfileWhileWaiting(page, held);
  await held.release();

  await expectFrameShowsOnlyRemainingCompany(page);
  await expect(page).toHaveURL(PROFILE_URL);
  await expect(page.getByText(`「${DELETED_COMPANY}」を削除しました。`)).toHaveCount(0);
});

test("事業所の削除の応答を page を離れずに待つと、一覧へ移って通知が出て、事業所の状態の GET は 1 回だけ出る", async ({
  page,
}) => {
  const held = await deleteCompanyHeld(page);
  await held.requested;
  let companyStateReads = 0;
  page.on("request", (request) => {
    if (request.method() === "GET" && endpointPattern("account.memberships").test(request.url())) {
      companyStateReads += 1;
    }
  });
  await held.release();

  await expect(page).toHaveURL(COMPANIES_URL);
  await expect(page.getByText(`「${DELETED_COMPANY}」を削除しました。`)).toBeVisible();
  await expectFrameShowsOnlyRemainingCompany(page);
  expect(companyStateReads).toBe(1);
});

test("事業所の追加の応答を待つ間に「戻る」と「進む」で所属事業所へ戻り、応答が届くと、枠が追加した事業所になり、dialog は開かない", async ({
  page,
}) => {
  const held = await addCompanyHeld(page);
  await goBackToProfileWhileWaiting(page, held);
  await page.goForward();
  await expect(page).toHaveURL(COMPANIES_URL);
  await held.release();

  await expect(companySwitcher(page).locator("option:checked")).toHaveText(ADDED_COMPANY);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
