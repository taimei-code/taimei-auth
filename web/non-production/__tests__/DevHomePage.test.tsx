import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DevHomePage } from "../DevHomePage";
import { NonProductionLayout } from "../NonProductionLayout";
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

const render = (overrides: Partial<DevHomeProps> = {}) =>
  renderToStaticMarkup(
    <DevHomePage
      _tag="DevHome"
      devAccounts={[OWNER, ADMIN]}
      browserAccounts={[]}
      viewer={SIGNED_OUT}
      destination={{ _tag: "AccountPage" }}
      signInAction="/dev-home/sign-in?q=1"
      signOutAction="/dev-home/sign-out?q=1"
      {...overrides}
    />,
  );

const accountListForm = (body: string) =>
  body.match(/<form id="accounts"[^>]*>.*?<\/form>/s)?.[0] ?? "";

describe("開発者ホームは、ログイン中の利用者と、選んでログインできる利用者の一覧を描く", () => {
  test("ログインしていなければ、そのことを出し、ログアウトのボタンを出さない", () => {
    const body = render();

    expect(body).toContain("ログインしていません");
    expect(body).not.toContain("ログアウト</button>");
  });

  test("ログイン中は、名前、メール、事業所と role を出し、現在の事業所に印を付ける", () => {
    const body = render({ viewer: signedInAs(OWNER) });
    const signedIn = body.slice(0, body.indexOf('id="accounts"'));

    for (const text of [
      "開発用 OWNER",
      "dev-owner@example.com",
      "事業所 1",
      "事業所 2",
      "OWNER",
      "MEMBER",
    ]) {
      expect(signedIn).toContain(text);
    }
    expect(signedIn.match(/現在の事業所/g)).toHaveLength(1);
  });

  test("利用者のボタンの文字はメールで、ログイン中の利用者の行は押せず「ログイン中」と出す", () => {
    const list = accountListForm(render({ viewer: signedInAs(OWNER) }));
    const buttons = [...list.matchAll(/<button([^>]*)>(.*?)<\/button>/gs)];

    expect(buttons.map(([, , text]) => text?.replace(/<[^>]+>/g, ""))).toEqual([
      "dev-owner@example.comログイン中",
      "dev-admin@example.com",
    ]);
    expect(buttons[0]?.[1]).toContain('disabled=""');
    expect(buttons[1]?.[1]).not.toContain('disabled=""');
  });

  test("一覧は「開発用アカウント」と「この browser でログインした利用者」の fieldset と legend に分ける", () => {
    const list = accountListForm(render({ browserAccounts: [BROWSER_USER] }));

    expect(
      [...list.matchAll(/<fieldset[^>]*><legend[^>]*>(.*?)<\/legend>/g)].map(([, label]) => label),
    ).toEqual(["開発用アカウント", "この browser でログインした利用者"]);
    expect(list).toContain("browser-user@example.com");
  });

  test("この browser の利用者がいなければ、ログインした状態で開発者ホームを開くと出ることを書く", () => {
    expect(accountListForm(render())).toContain(
      "ログインした状態でこの browser の開発者ホームを開くと、その利用者がここに出ます。",
    );
  });

  test("ログアウトの form は一覧の form の外にあり、各利用者のボタンは userId としてその id を送る", () => {
    const body = render({ viewer: signedInAs(OWNER) });
    const list = accountListForm(body);

    expect(body).toContain('<form action="/dev-home/sign-out?q=1" method="post">');
    expect(list).not.toContain("sign-out");
    expect(list).toMatch(/<form id="accounts"[^>]*action="\/dev-home\/sign-in\?q=1"/);
    expect(list).toMatch(/<button(?=[^>]*name="userId")(?=[^>]*value="dev-admin")[^>]*>/);
  });

  test("redirect_url を受けた時は、その URL と「アプリケーションに戻る」を出し、「アカウント管理画面を開く」を出さない", () => {
    const body = render({
      destination: { _tag: "Application", redirectUrl: "http://app.example/x" },
    });

    expect(body).toContain("http://app.example/x");
    expect(body).toMatch(/<a[^>]*href="http:\/\/app\.example\/x"[^>]*>アプリケーションに戻る<\/a>/);
    expect(body).not.toContain("アカウント管理画面を開く");
  });

  test("redirect_url を受けない時は、「アカウント管理画面を開く」を出し、「アプリケーションに戻る」を出さない", () => {
    const body = render();

    expect(body).toMatch(/<a[^>]*href="\/account"[^>]*>アカウント管理画面を開く<\/a>/);
    expect(body).not.toContain("アプリケーションに戻る");
  });

  test("戻り先の link は、利用者の一覧より前にある", () => {
    const body = render();

    expect(body.indexOf("アカウント管理画面を開く")).toBeLessThan(body.indexOf('id="accounts"'));
  });

  test.each([
    [signedInAs(OWNER, "JustSignedIn"), "開発用 OWNER でログインしました"],
    [{ _tag: "SignedOut", notice: "JustSignedOut" } as const, "ログアウトしました"],
  ])("選んだ直後とログアウトした直後は、status の要素でそのことを出す (%#)", (viewer, text) => {
    expect(render({ viewer })).toMatch(new RegExp(`<div[^>]*role="status"[^>]*>${text}</div>`));
  });

  test("通知が無ければ、status の要素を出さない", () => {
    expect(render({ viewer: signedInAs(OWNER) })).not.toContain('role="status"');
    expect(render()).not.toContain('role="status"');
  });

  test("候補が 8 人以下なら、絞り込み欄を出さない", () => {
    expect(render()).not.toContain("<search");
  });
});

describe("本番以外の画面の上端の帯", () => {
  test("header に、本番以外の環境の画面で、本番の auth ホストには無いことを出す", () => {
    const body = renderToStaticMarkup(<NonProductionLayout>x</NonProductionLayout>);

    expect(body).toMatch(
      /^<header[^>]*><p><strong[^>]*>本番以外の環境<\/strong>の画面です。本番の auth ホストにはありません。<\/p><\/header><main/,
    );
  });
});
