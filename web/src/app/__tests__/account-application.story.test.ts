import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { expect as expectScene, given, scene, text } from "foldkit/scene";
import { fromString } from "foldkit/url";

import {
  init,
  LeaveToCompanySignup,
  LoadCompanyState,
  Message,
  type Model,
  SignOut,
  update,
  view,
} from "../account/main";
import { LeaveToSignIn, LoadDocument, PushUrl, ReplaceDocument } from "../document-navigation";

const ORIGIN = "https://auth.taimei-code.com";

const urlOf = (href: string) =>
  Option.getOrThrowWith(fromString(href), () => new Error(`URL として読めない: ${href}`));

const opened = (path = "/account") => init(urlOf(`${ORIGIN}${path}`));

const ready = (path = "/account"): Model =>
  update(
    opened(path).model,
    Message.SucceededLoadCompanyState({
      isCompanyMember: true,
      maybeCurrentCompany: Option.none(),
    }),
  ).model;

describe("アカウント管理画面の入口の確認", () => {
  test("開くと事業状態を 1 回だけ読む", () => {
    expect(opened().commands).toMatchObject([{ name: LoadCompanyState.name }]);
  });

  test("Unauthorized なら今の URL を戻り先にしてログイン画面へ移る", () => {
    expect(
      update(opened().model, Message.FailedLoadCompanyState({ failure: "Unauthorized" })).commands,
    ).toMatchObject([{ name: LeaveToSignIn.name }]);
  });

  test("所属が 0 件なら事業所の登録へ移る", () => {
    expect(
      update(
        opened().model,
        Message.SucceededLoadCompanyState({
          isCompanyMember: false,
          maybeCurrentCompany: Option.none(),
        }),
      ).commands,
    ).toMatchObject([{ name: LeaveToCompanySignup.name }]);
  });

  test("通信の失敗では移らずに画面を出す", () => {
    const next = update(
      opened("/account/sessions").model,
      Message.FailedLoadCompanyState({ failure: "Unexpected" }),
    ).model;
    expect(next.entry._tag).toBe("Ready");
    expect(Option.map(next.maybePage, (page) => page._tag)).toEqual(Option.some("Sessions"));
  });
});

describe("枠の遷移とログアウト", () => {
  test("アカウント管理画面の中の link は履歴に積み、知らない path は document を読み直す", () => {
    const clicked = (href: string) =>
      update(ready(), Message.ClickedLink({ request: { _tag: "Internal", url: urlOf(href) } }))
        .commands;
    expect(clicked(`${ORIGIN}/account/connections`)).toMatchObject([{ name: PushUrl.name }]);
    expect(clicked(`${ORIGIN}/auth/`)).toMatchObject([{ name: LoadDocument.name }]);
  });

  test("ログアウトに成功したら / へ document を置き換え、二重の click では 1 回だけ送る", () => {
    const first = update(ready(), Message.ClickedSignOut());
    const second = update(first.model, Message.ClickedSignOut());
    expect(first.commands).toMatchObject([{ name: SignOut.name }]);
    expect(second.commands ?? []).toEqual([]);
    expect(update(first.model, Message.SucceededSignOut()).commands).toMatchObject([
      { name: ReplaceDocument.name, args: { href: "/" } },
    ]);
  });

  test("ログアウトに失敗したら通知を出し、押し直せる", () => {
    const failed = update(update(ready(), Message.ClickedSignOut()).model, Message.FailedSignOut());
    expect(failed.model.signOut._tag).toBe("Idle");
    expect(failed.model.toast.entries.length).toBe(1);
  });
});

describe("アカウント管理画面の知らない path", () => {
  test("/account の下の知らない path は、既定のエラーの文言を出す", () => {
    scene(
      { update, view },
      given(ready("/account/no-such-page")),
      expectScene(text("エラーが発生しました")).toExist(),
    );
  });
});
