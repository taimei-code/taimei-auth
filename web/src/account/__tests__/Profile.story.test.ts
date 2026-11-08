import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import {
  Command,
  expectNoOutMessage,
  expectOutMessage,
  given,
  message,
  model,
  story,
} from "foldkit/story";

import { DeleteAccount } from "../account-deletion";
import * as AccountDeletion from "../account-deletion";
import {
  init,
  LoadSession,
  Message,
  type Model,
  OutMessage,
  SaveProfile,
  update,
  UploadAvatar,
} from "../pages/Profile";

const VISIT = 3;

const opened = () => init({ visit: VISIT, maybeCurrentCompany: Option.none() });

const USER = { name: "山田", email: "yamada@example.com", maybeImageUrl: Option.none() };

const loaded = (): Model =>
  update(
    opened().model,
    Message.SucceededLoadSession({ visit: VISIT, maybeUser: Option.some(USER) }),
  ).model;

const presentOf = (current: Model) =>
  current.profile._tag === "Present" ? current.profile : undefined;

const deletionMessage = (message: AccountDeletion.Message) =>
  Message.GotAccountDeletionMessage({ message });

describe("プロフィールを開く", () => {
  test("開くと session の user を読みに行き、user が無ければ何も出さない", () => {
    expect(opened().commands).toMatchObject([{ name: LoadSession.name, args: { visit: VISIT } }]);
    story(
      update,
      given(opened().model),
      message(Message.SucceededLoadSession({ visit: VISIT, maybeUser: Option.none() })),
      model((next) => {
        expect(next.profile._tag).toBe("Absent");
      }),
    );
  });

  test("古い画面の session の結果は、今の画面を変えない", () => {
    story(
      update,
      given(opened().model),
      message(Message.SucceededLoadSession({ visit: VISIT - 1, maybeUser: Option.some(USER) })),
      model((next) => {
        expect(next.profile._tag).toBe("Loading");
      }),
    );
  });
});

describe("名前の保存", () => {
  test("保存すると名前を送り、成功で「保存しました。」を通知する", () => {
    story(
      update,
      given(loaded()),
      message(Message.UpdatedName({ value: "山田太郎" })),
      message(Message.SubmittedProfileForm()),
      Command.expectHas(SaveProfile),
      Command.resolve(SaveProfile, Message.SucceededSaveProfile({ visit: VISIT })),
      expectOutMessage(OutMessage.Notified({ tone: "Success", text: "保存しました。" })),
    );
  });

  test("保存に成功したら、写真の頭文字と代替の文に使う名前も新しい名前にする", () => {
    story(
      update,
      given(loaded()),
      message(Message.UpdatedName({ value: "佐藤" })),
      message(Message.SubmittedProfileForm()),
      Command.resolve(SaveProfile, Message.SucceededSaveProfile({ visit: VISIT })),
      model((next) => {
        expect(presentOf(next)?.loadedName).toBe("佐藤");
      }),
      expectOutMessage(OutMessage.Notified({ tone: "Success", text: "保存しました。" })),
    );
  });

  test("better-auth が error を返したら、その文言を失敗として通知する", () => {
    story(
      update,
      given(loaded()),
      message(Message.SubmittedProfileForm()),
      Command.resolve(
        SaveProfile,
        Message.FailedSaveProfile({ visit: VISIT, message: "保存に失敗しました。" }),
      ),
      expectOutMessage(OutMessage.Notified({ tone: "Error", text: "保存に失敗しました。" })),
    );
  });

  test("保存中の二重の submit は捨てる", () => {
    const first = update(loaded(), Message.SubmittedProfileForm());
    const second = update(first.model, Message.SubmittedProfileForm());
    expect(first.commands).toMatchObject([{ name: SaveProfile.name }]);
    expect(second.commands).toBeUndefined();
  });

  test("古い画面の保存の結果は通知しない", () => {
    story(
      update,
      given(update(loaded(), Message.SubmittedProfileForm()).model),
      message(Message.SucceededSaveProfile({ visit: VISIT - 1 })),
      expectNoOutMessage(),
    );
  });
});

describe("プロフィール写真", () => {
  test("選んだ file を送り、失敗したら文言を残す", () => {
    const file = new File(["x"], "me.png", { type: "image/png" });
    story(
      update,
      given(loaded()),
      message(Message.SelectedAvatarFiles({ files: [file] })),
      Command.resolve(
        UploadAvatar,
        Message.FailedUploadAvatar({
          visit: VISIT,
          maybeImageUrl: Option.none(),
          message: "アップロードに失敗しました",
        }),
      ),
      model((next) => {
        expect(presentOf(next)?.avatar).toEqual({
          _tag: "Rejected",
          message: "アップロードに失敗しました",
        });
      }),
    );
  });

  test("送信中に二重に選んでも、送るのは 1 回だけ", () => {
    const file = new File(["x"], "me.png", { type: "image/png" });
    const first = update(loaded(), Message.SelectedAvatarFiles({ files: [file] }));
    const second = update(first.model, Message.SelectedAvatarFiles({ files: [file] }));
    expect(first.commands).toMatchObject([{ name: UploadAvatar.name }]);
    expect(second.commands).toBeUndefined();
  });
});

describe("退会", () => {
  const confirming = (): Model =>
    update(loaded(), deletionMessage(AccountDeletion.Message.ClickedConfirmDeletion())).model;

  test("確定すると削除を送り、成功しても画面は送信中のまま (sign-out と document の置き換えは削除の Command の中で行う)", () => {
    story(
      update,
      given(loaded()),
      message(deletionMessage(AccountDeletion.Message.ClickedConfirmDeletion())),
      Command.resolve(
        DeleteAccount,
        AccountDeletion.Message.SucceededDeleteAccount({ visit: VISIT }),
      ),
      model((next) => {
        expect(next.deletion.deletion._tag).toBe("Submitting");
      }),
      expectNoOutMessage(),
    );
  });

  test("唯一の OWNER の事業所があると中断し、文言を出す", () => {
    story(
      update,
      given(confirming()),
      message(
        deletionMessage(
          AccountDeletion.Message.FailedDeleteAccount({ visit: VISIT, failure: "LastOwner" }),
        ),
      ),
      model((next) => {
        expect(next.deletion.deletion).toEqual({
          _tag: "Rejected",
          message: "所有者として残っている事業所があります。先に委譲または削除してください。",
        });
      }),
      expectNoOutMessage(),
    );
  });

  test("削除中の二重の確定は捨てる", () => {
    const second = update(
      confirming(),
      deletionMessage(AccountDeletion.Message.ClickedConfirmDeletion()),
    );
    expect(second.commands ?? []).toEqual([]);
  });

  test("削除が Unauthorized ならログインを求める", () => {
    story(
      update,
      given(confirming()),
      message(
        deletionMessage(
          AccountDeletion.Message.FailedDeleteAccount({ visit: VISIT, failure: "Unauthorized" }),
        ),
      ),
      expectOutMessage(OutMessage.RequiredSignIn()),
    );
  });
});
