import { describe, test } from "bun:test";
import { Option } from "effect";
import {
  all,
  expect,
  expectAll,
  given,
  inside,
  role,
  scene,
  selector,
  text,
  type,
  within,
} from "foldkit/scene";

import { init, type Model, update, view } from "../DevHome";
import type { DevHomeProps, PageAccount, Viewer } from "../page-props";

const OWNER: PageAccount = {
  id: "dev-owner",
  name: "開発用 OWNER",
  email: "dev-owner@example.com",
  companies: [
    { id: "cmp-1", name: "事業所 1", role: "OWNER", isCurrent: true },
    { id: "cmp-2", name: "事業所 2", role: "MEMBER", isCurrent: false },
  ],
};
const ADMIN: PageAccount = {
  ...OWNER,
  id: "dev-admin",
  name: "開発用 ADMIN",
  email: "dev-admin@example.com",
};
const BROWSER_USER: PageAccount = {
  ...OWNER,
  id: "browser-user",
  email: "browser-user@example.com",
};

const SIGNED_OUT: Viewer = { _tag: "SignedOut", notice: "None" };
const signedInAs = (account: PageAccount, notice: "JustSignedIn" | "None" = "None"): Viewer => ({
  _tag: "SignedIn",
  account,
  notice,
});

const devHome = (overrides: Partial<DevHomeProps> = {}): Model =>
  init(
    Option.some({
      _tag: "DevHome",
      devAccounts: [OWNER, ADMIN],
      browserAccounts: [],
      viewer: SIGNED_OUT,
      destination: { _tag: "AccountPage" },
      signInAction: "/dev-home/sign-in?q=1",
      signOutAction: "/dev-home/sign-out?q=1",
      ...overrides,
    }),
  ).model;

const signedInSection = role("region", { name: "ログイン中の利用者" });
const accountList = role("region", { name: "ログインする利用者を選ぶ" });
const accountsForm = selector("form#accounts");
const accountFilter = role("searchbox", { name: "利用者を絞り込む" });

describe("開発者ホームは、ログイン中の利用者と、選んでログインできる利用者の一覧を描く", () => {
  test("ログインしていなければ、そのことを出し、ログアウトのボタンを出さない", () => {
    scene(
      { update, view },
      given(devHome()),
      expect(within(signedInSection, text("ログインしていません"))).toExist(),
      expect(role("button", { name: "ログアウト" })).toBeAbsent(),
    );
  });

  test("ログイン中は、名前、メール、事業所と role を出し、現在の事業所に印を付ける", () => {
    scene(
      { update, view },
      given(devHome({ viewer: signedInAs(OWNER) })),
      inside(
        signedInSection,
        expect(text("開発用 OWNER")).toExist(),
        expect(text("dev-owner@example.com")).toExist(),
        expect(text("事業所 1")).toExist(),
        expect(text("事業所 2")).toExist(),
        expect(text("OWNER")).toExist(),
        expect(text("MEMBER")).toExist(),
        expectAll(all.text("現在の事業所")).toHaveCount(1),
      ),
    );
  });

  test("利用者のボタンの名前はメールで、ログイン中の利用者の行は押せず「ログイン中」と出し、userId としてその id を送る", () => {
    scene(
      { update, view },
      given(devHome({ viewer: signedInAs(OWNER) })),
      inside(
        accountsForm,
        expect(role("button", { name: "dev-owner@example.comログイン中" })).toBeDisabled(),
        expect(role("button", { name: "dev-admin@example.com" })).toBeEnabled(),
        expect(role("button", { name: "dev-admin@example.com" })).toHaveAttr("name", "userId"),
        expect(role("button", { name: "dev-admin@example.com" })).toHaveAttr("value", "dev-admin"),
      ),
      expect(accountsForm).toHaveAttr("action", "/dev-home/sign-in?q=1"),
      expect(accountsForm).toHaveAttr("method", "post"),
    );
  });

  test("ログアウトの form は一覧の form の外にあり、sign-out の action に送る", () => {
    scene(
      { update, view },
      given(devHome({ viewer: signedInAs(OWNER) })),
      expect(selector('form[action="/dev-home/sign-out?q=1"][method="post"]')).toExist(),
      expect(within(accountsForm, role("button", { name: "ログアウト" }))).toBeAbsent(),
    );
  });

  test("一覧は「開発用アカウント」と「この browser でログインした利用者」の fieldset と legend に分ける", () => {
    scene(
      { update, view },
      given(devHome({ browserAccounts: [BROWSER_USER] })),
      inside(
        accountsForm,
        expect(role("group", { name: "開発用アカウント" })).toExist(),
        expect(role("group", { name: "この browser でログインした利用者" })).toExist(),
        expect(role("button", { name: "browser-user@example.com" })).toExist(),
      ),
    );
  });

  test("この browser の利用者がいなければ、ログインした状態で開発者ホームを開くと出ることを書く", () => {
    scene(
      { update, view },
      given(devHome()),
      expect(
        within(
          accountsForm,
          text("ログインした状態でこの browser の開発者ホームを開くと、その利用者がここに出ます。"),
        ),
      ).toExist(),
    );
  });

  test("redirect_url を受けた時は、その URL と「アプリケーションに戻る」を出し、「アカウント管理画面を開く」を出さない", () => {
    scene(
      { update, view },
      given(devHome({ destination: { _tag: "Application", redirectUrl: "http://app.example/x" } })),
      expect(text("http://app.example/x")).toExist(),
      expect(role("link", { name: "アプリケーションに戻る" })).toHaveAttr(
        "href",
        "http://app.example/x",
      ),
      expect(role("link", { name: "アカウント管理画面を開く" })).toBeAbsent(),
    );
  });

  test("redirect_url を受けない時は、「アカウント管理画面を開く」を出し、「アプリケーションに戻る」を出さない", () => {
    scene(
      { update, view },
      given(devHome()),
      expect(role("link", { name: "アカウント管理画面を開く" })).toHaveAttr("href", "/account"),
      expect(role("link", { name: "アプリケーションに戻る" })).toBeAbsent(),
    );
  });

  test.each([
    [signedInAs(OWNER, "JustSignedIn"), "開発用 OWNER でログインしました"],
    [{ _tag: "SignedOut", notice: "JustSignedOut" } as const, "ログアウトしました"],
  ])("選んだ直後とログアウトした直後は、status の要素でそのことを出す (%#)", (viewer, notice) => {
    scene({ update, view }, given(devHome({ viewer })), expect(role("status")).toHaveText(notice));
  });

  test("通知が無ければ、status の要素を出さない", () => {
    scene(
      { update, view },
      given(devHome({ viewer: signedInAs(OWNER) })),
      expect(role("status")).toBeAbsent(),
    );
  });

  test("候補が 8 人以下なら、絞り込み欄を出さない", () => {
    scene({ update, view }, given(devHome()), expect(accountFilter).toBeAbsent());
  });

  test("候補が 8 人を超えたら絞り込み欄を出し、入れた文字に一致しない利用者を隠し、一致が無ければそう出す", () => {
    const browserAccounts = Array.from({ length: 7 }, (_, index) => ({
      ...BROWSER_USER,
      id: `browser-${index}`,
      email: `browser-${index}@example.com`,
    }));
    scene(
      { update, view },
      given(devHome({ browserAccounts })),
      type(accountFilter, "DEV-OWNER"),
      inside(
        accountList,
        expect(role("button", { name: "dev-owner@example.com" })).toExist(),
        expect(role("button", { name: "dev-admin@example.com" })).toBeAbsent(),
      ),
      type(accountFilter, "no-such-user"),
      expect(within(accountList, text("「no-such-user」に一致する利用者はいません。"))).toExist(),
    );
  });
});

describe("本番以外の画面の上端の帯", () => {
  test("header に、本番以外の環境の画面で、本番の auth ホストには無いことを出す", () => {
    scene(
      { update, view },
      given(devHome()),
      expect(role("banner")).toHaveText(
        "本番以外の環境の画面です。本番の auth ホストにはありません。",
      ),
    );
  });

  test("page props を読めなかった時は、読み直しを促す文言を出す", () => {
    scene(
      { update, view },
      given(init(Option.none()).model),
      expect(role("alert")).toHaveText(
        "開発者ホームの情報を読めませんでした。ページを再読み込みしてください。",
      ),
    );
  });
});
