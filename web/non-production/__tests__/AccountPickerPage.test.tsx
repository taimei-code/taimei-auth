import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountPickerPage } from "../AccountPickerPage";

const render = () =>
  renderToStaticMarkup(
    <AccountPickerPage
      _tag="AccountPicker"
      accounts={[
        {
          id: "user-a",
          name: "利用者 A",
          email: "a@example.com",
          companies: [{ id: "cmp", name: "事業所 1", role: "OWNER", isCurrent: false }],
        },
      ]}
      chooseAction="/testing/v1/account-picker?a=1"
      signUpHref="/auth/signup?a=1"
    />,
  );

describe("試験の環境の共通ログイン画面は、利用者ごとに選ぶ form を出す", () => {
  test("各行は、選ぶ送り先へ、その利用者の id を userId として POST する", () => {
    const body = render();

    expect(body).toMatch(/<form action="\/testing\/v1\/account-picker\?a=1" method="post"><button/);
    const button = body.match(/<button([^>]*)>/)?.[1];
    expect(button).toContain('type="submit"');
    expect(button).toContain('name="userId"');
    expect(button).toContain('value="user-a"');
  });
});
