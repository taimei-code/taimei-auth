import { afterAll, beforeAll, describe, expect as expectBun, test } from "bun:test";
import { Effect, Fiber, Option, Redacted } from "effect";
// oxlint-disable-next-line no-restricted-imports -- コピーの結果を隠す 3 秒の待ちを、仮想の時計 (TestClock) で進めて確かめる
import { TestClock } from "effect/testing";
import {
  all,
  click,
  Command,
  expect,
  expectAll,
  given,
  Mount,
  role,
  scene,
  text,
} from "foldkit/scene";

import * as CopyResult from "../../mfa/copy-result";
import * as MfaEnrollment from "../../mfa/mfa-enrollment";
import * as PasskeySettings from "../../passkey/passkey-settings";
import {
  DIALOG_RESOURCES_RELEASED_RESOLVER,
  FIRST_DIALOG_CLOSING_RESOLVERS,
  FIRST_DIALOG_OPENING_RESOLVERS,
  pendingDialogTransitionResolvers,
} from "../../shared/__tests__/dialog-resolvers";
import { Dialog } from "../../shared/ui/dialog-view";
import { init, Message, type Model, update, view } from "../pages/Security";

const succeededLoad = (mfa: Model["mfa"], passkeyList: Model["passkeyList"]): Message =>
  Message.SucceededLoadSecuritySettings({
    passkeyList,
    visit: 1,
    refreshNumber: 0,
    mfa,
    maybeTexts: Option.none(),
  });

const loaded = (mfa: Model["mfa"], passkeyList: Model["passkeyList"] = { _tag: "Hidden" }): Model =>
  update(init(1).model, succeededLoad(mfa, passkeyList)).model;

describe("セキュリティの画面", () => {
  test("「有効にする」を押すと MFA の有効化の dialog を開き、登録の応答を待つ間は読み込み中を出す", () => {
    const clicked = update(
      loaded({ _tag: "Disabled" }),
      Message.GotMfaEnrollmentMessage({ message: MfaEnrollment.Message.ClickedEnable() }),
    ).model;
    scene(
      { update, view },
      given(clicked),
      Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
      Command.resolveAll(...pendingDialogTransitionResolvers(clicked.enrollment.dialog)),
      expect(role("heading", { name: "多要素認証 (MFA) を有効にする" })).toExist(),
      expect(role("status")).toHaveText("読み込み中…"),
    );
  });

  test("状態を読む間は status を出す", () => {
    scene(
      { update, view },
      given(init(1).model),
      expect(role("heading", { name: "セキュリティ" })).toExist(),
      expect(role("status")).toExist(),
    );
  });

  test("状態の取得に失敗すると、取得できなかった旨を alert で出す", () => {
    scene(
      { update, view },
      given({ ...init(1).model, mfa: { _tag: "Failed" } }),
      expect(role("alert")).toHaveText("多要素認証 (MFA) の設定状態を取得できませんでした。"),
    );
  });

  test("無効なら「無効」と有効にするボタンを出し、残数を出さない", () => {
    scene(
      { update, view },
      given(loaded({ _tag: "Disabled" })),
      expect(text("無効")).toExist(),
      expect(role("button", { name: "有効にする" })).toExist(),
      expect(text("リカバリーコードの残り", { exact: false })).toBeAbsent(),
      expect(text("実装予定")).toBeAbsent(),
    );
  });

  test("有効なら「有効」と残数と無効にするボタンを出し、残りが少なければ注意を出す", () => {
    scene(
      { update, view },
      given(loaded({ _tag: "Enabled", recoveryCodesRemaining: 2 })),
      expect(text("有効")).toExist(),
      expect(text("リカバリーコードの残り: 2 個")).toExist(),
      expect(role("button", { name: "無効にする" })).toExist(),
      expect(
        text(
          "リカバリーコードの残りが少なくなっています。使い切ると、認証アプリを失った時にログインできなくなります (再発行の導線はありません)。",
        ),
      ).toExist(),
    );
  });

  describe("パスキーの行", () => {
    const USED = {
      id: "passkey-1",
      createdAt: "2026-03-04T03:00:00.000Z",
      maybeLastUsedAt: Option.some("2026-05-06T03:00:00.000Z"),
    };

    test("登録できない 0 本の時は行を出さず、一覧は MFA の行だけになる", () => {
      scene(
        { update, view },
        given(loaded({ _tag: "Disabled" }, { _tag: "Hidden" })),
        expect(text("パスキー", { exact: true })).toBeAbsent(),
        expectAll(all.role("listitem")).toHaveCount(1),
      );
    });

    test("登録できる 0 本の時は、無いことと「登録する」を出す", () => {
      scene(
        { update, view },
        given(loaded({ _tag: "Disabled" }, { _tag: "Shown", passkeys: [], registrable: true })),
        expect(text("登録したパスキーはありません")).toExist(),
        expect(role("button", { name: "登録する" })).toExist(),
      );
    });

    test("MFA が有効でも、登録できれば「登録する」を出し、押すと確認コードの入力の dialog を出す", () => {
      const listed = loaded(
        { _tag: "Enabled", recoveryCodesRemaining: 8 },
        { _tag: "Shown", passkeys: [USED], registrable: true },
      );
      const opened = update(
        listed,
        Message.GotPasskeySettingsMessage({
          message: PasskeySettings.Message.ClickedRegisterWithTotp(),
        }),
      ).model;
      scene(
        { update, view },
        given(listed),
        expect(role("button", { name: "登録する" })).toBeEnabled(),
      );
      scene(
        { update, view },
        given(opened),
        Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
        Command.resolveAll(...pendingDialogTransitionResolvers(opened.passkeySettings.dialog)),
        expect(role("heading", { name: "パスキーを登録する" })).toExist(),
        expect(role("textbox", { name: "確認コード" })).toExist(),
        expect(role("button", { name: "次へ" })).toExist(),
        expect(role("button", { name: "リカバリーコードを使う" })).toBeAbsent(),
      );
    });

    test("一覧の各項目に登録日と最後に使った日を出し、使っていないパスキーは最後に使った日を「未使用」と出す", () => {
      scene(
        { update, view },
        given(
          loaded(
            { _tag: "Disabled" },
            {
              _tag: "Shown",
              passkeys: [
                {
                  id: "passkey-used",
                  createdAt: "2026-03-04T12:00:00.000Z",
                  maybeLastUsedAt: Option.some("2026-05-06T12:00:00.000Z"),
                },
                {
                  id: "passkey-unused",
                  createdAt: "2026-07-08T12:00:00.000Z",
                  maybeLastUsedAt: Option.none(),
                },
              ],
              registrable: true,
            },
          ),
        ),
        expect(text("登録日 2026/03/04")).toExist(),
        expect(text("最後に使った日 2026/05/06")).toExist(),
        expect(text("登録日 2026/07/08")).toExist(),
        expect(text("最後に使った日 未使用")).toExist(),
      );
    });

    test("使っていないパスキーは最後に使った日を「未使用」と出す", () => {
      scene(
        { update, view },
        given(
          loaded(
            { _tag: "Disabled" },
            {
              _tag: "Shown",
              passkeys: [{ ...USED, maybeLastUsedAt: Option.none() }],
              registrable: false,
            },
          ),
        ),
        expect(text("最後に使った日 未使用")).toExist(),
        expect(role("button", { name: "登録する" })).toBeAbsent(),
      );
    });

    const LIMIT_NOTICE =
      "登録できるパスキーの数の上限に達しています。不要なパスキーを削除すると、新しく登録できます。";

    const listing = (count: number, registrable: boolean): Model["passkeyList"] => ({
      _tag: "Shown",
      passkeys: Array.from({ length: count }, (_, index) => ({ ...USED, id: `passkey-${index}` })),
      registrable,
    });

    test("10 本ある時は「登録する」を押せず、理由と削除を促す文言を出して「登録する」の説明に結ぶ", () => {
      scene(
        { update, view },
        given(loaded({ _tag: "Disabled" }, listing(10, true))),
        expect(role("button", { name: "登録する" })).toBeDisabled(),
        expect(role("button", { name: "登録する" })).toHaveAccessibleDescription(LIMIT_NOTICE),
        expect(text(LIMIT_NOTICE)).toExist(),
      );
    });

    test("9 本の時は「登録する」を押せ、上限の文言を出さない", () => {
      scene(
        { update, view },
        given(loaded({ _tag: "Disabled" }, listing(9, true))),
        expect(role("button", { name: "登録する" })).toBeEnabled(),
        expect(text(LIMIT_NOTICE)).toBeAbsent(),
      );
    });

    test("10 本あっても、登録できない時は「登録する」も上限の文言も出さず、MFA が有効な時は「登録する」を押せずに上限の文言を出す", () => {
      scene(
        { update, view },
        given(loaded({ _tag: "Disabled" }, listing(10, false))),
        expect(role("button", { name: "登録する" })).toBeAbsent(),
        expect(text(LIMIT_NOTICE)).toBeAbsent(),
      );
      scene(
        { update, view },
        given(loaded({ _tag: "Enabled", recoveryCodesRemaining: 8 }, listing(10, true))),
        expect(role("button", { name: "登録する" })).toBeDisabled(),
        expect(text(LIMIT_NOTICE)).toExist(),
      );
    });

    test("一覧を読めない時は、パスキーの行に取得できなかった旨を alert で出し、MFA の行は残す", () => {
      scene(
        { update, view },
        given(loaded({ _tag: "Disabled" }, { _tag: "Failed" })),
        expect(role("alert")).toHaveText("パスキーの一覧を取得できませんでした。"),
        expect(role("button", { name: "有効にする" })).toExist(),
      );
    });
  });
});

describe("パスキーの削除", () => {
  const PASSKEY = {
    id: "passkey-1",
    createdAt: "2026-03-04T12:00:00.000Z",
    maybeLastUsedAt: Option.none(),
  };
  const LISTED: Model["passkeyList"] = { _tag: "Shown", passkeys: [PASSKEY], registrable: false };
  const DELETE_BUTTON = role("button", {
    name: "登録日 2026/03/04、最後に使った日 未使用 のパスキーを削除",
  });
  const DELETION_TITLE = role("heading", { name: "パスキーの削除" });

  const confirming = (mfa: Model["mfa"]): Model =>
    update(
      loaded(mfa, LISTED),
      Message.GotPasskeySettingsMessage({
        message: PasskeySettings.Message.ClickedDelete({ passkey: PASSKEY }),
      }),
    ).model;

  test("MFA が有効で登録できない時も、各項目に登録日と最後に使った日を名前に含む「削除」を出す", () => {
    scene(
      { update, view },
      given(loaded({ _tag: "Enabled", recoveryCodesRemaining: 8 }, LISTED)),
      expect(DELETE_BUTTON).toExist(),
      expect(role("button", { name: "登録する" })).toBeAbsent(),
    );
  });

  test("「削除」を押すと、登録日と最後に使った日で対象を示す確認の dialog を出す", () => {
    const opened = confirming({ _tag: "Disabled" });
    scene(
      { update, view },
      given(opened),
      Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
      Command.resolveAll(...pendingDialogTransitionResolvers(opened.passkeySettings.dialog)),
      expect(DELETION_TITLE).toExist(),
      expect(
        text(
          "登録日 2026/03/04、最後に使った日 未使用 のパスキーを削除します。削除すると、このパスキーではログインできなくなります。",
        ),
      ).toExist(),
      expect(role("button", { name: "キャンセル" })).toExist(),
      expect(role("button", { name: "削除する" })).toExist(),
    );
  });

  test("確認の dialog が見えている間に一覧が行を出さない状態になっても、dialog を描き続ける", () => {
    const rowHidden = update(
      confirming({ _tag: "Disabled" }),
      succeededLoad({ _tag: "Disabled" }, { _tag: "Hidden" }),
    ).model;
    scene(
      { update, view },
      given(rowHidden),
      Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
      Command.resolveAll(...pendingDialogTransitionResolvers(rowHidden.passkeySettings.dialog)),
      expect(DELETION_TITLE).toExist(),
    );
  });
});

const ENROLLMENT = {
  enrollmentId: "enrollment-1",
  totpUri: Redacted.make("otpauth://totp/taimei:me?secret=JBSWY3DPEHPK3PXP"),
  recoveryCodes: Redacted.make(["aaaaa-11111", "bbbbb-22222"]),
};

const enrollment = (message: MfaEnrollment.Message): Message =>
  Message.GotMfaEnrollmentMessage({ message });

const requestedEnrollMfa = (commands: ReadonlyArray<{ name: string; args?: unknown }>) => {
  const found = commands.find((command) => command.name === MfaEnrollment.EnrollMfa.name);
  if (found === undefined) {
    throw new Error("EnrollMfa was not requested");
  }
  const { visit, requestNumber } = found.args as { visit: number; requestNumber: number };
  return { visit, requestNumber };
};

const DIALOG_TITLE = "多要素認証 (MFA) を有効にする";

describe("MFA の有効化の dialog を閉じる animation", () => {
  test("dialog を閉じる操作の後、閉じる animation が終わるまで中身を描き、終わると消す", () => {
    const opened = update(
      loaded({ _tag: "Disabled" }),
      enrollment(MfaEnrollment.Message.ClickedEnable()),
    );
    const showingSecret = update(
      opened.model,
      enrollment(
        MfaEnrollment.Message.SucceededEnrollMfa({
          ...requestedEnrollMfa(opened.commands ?? []),
          enrollment: ENROLLMENT,
        }),
      ),
    ).model;
    scene(
      { update, view },
      given(showingSecret),
      Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
      Command.resolveAll(...FIRST_DIALOG_OPENING_RESOLVERS),
      expect(role("heading", { name: DIALOG_TITLE })).toExist(),
      click(role("button", { name: "閉じる" })),
      expect(role("heading", { name: DIALOG_TITLE })).toExist(),
      Command.resolveAll(...FIRST_DIALOG_CLOSING_RESOLVERS, DIALOG_RESOURCES_RELEASED_RESOLVER),
      expect(role("heading", { name: DIALOG_TITLE })).toBeAbsent(),
      Mount.expectEnded(Dialog.AcquireResources),
    );
  });
});

type Running = { model: Model; waits: Array<Fiber.Fiber<unknown, unknown>> };

type AnyCommand = {
  name: string;
  args?: unknown;
  effect: Effect.Effect<unknown, unknown, unknown>;
};

const COPIED = "コピーしました";
const NOT_COPIED = "コピーできませんでした";

const send = (
  running: Running,
  message: Message,
): Effect.Effect<{ running: Running; commands: ReadonlyArray<AnyCommand> }, unknown, never> =>
  Effect.gen(function* () {
    const result = update(running.model, message);
    const commands = (result.commands ?? []) as ReadonlyArray<AnyCommand>;
    let next: Running = { model: result.model, waits: running.waits };
    for (const command of commands) {
      if (command.name === CopyResult.WaitBeforeHidingCopyResult.name) {
        const fiber = yield* Effect.forkChild(
          command.effect as Effect.Effect<unknown, unknown, never>,
        );
        next = { ...next, waits: [...next.waits, fiber] };
      } else if (command.name === CopyResult.CopyText.name) {
        const copied = (yield* command.effect as Effect.Effect<unknown, unknown, never>) as Message;
        next = (yield* send(next, copied)).running;
      }
    }
    yield* Effect.yieldNow;
    return { running: next, commands };
  });

const deliverFinishedWaits = (running: Running): Effect.Effect<Running, unknown, never> =>
  Effect.gen(function* () {
    let next: Running = running;
    for (const fiber of running.waits) {
      if (fiber.pollUnsafe() !== undefined) {
        next = { ...next, waits: next.waits.filter((each) => each !== fiber) };
        const message = (yield* Fiber.join(fiber)) as Message;
        next = (yield* send(next, message)).running;
      }
    }
    return next;
  });

const advance = (running: Running, millis: number): Effect.Effect<Running, unknown, never> =>
  Effect.gen(function* () {
    yield* TestClock.adjust(millis);
    yield* Effect.yieldNow;
    return yield* deliverFinishedWaits(running);
  });

const sendAll = (running: Running, ...messages: ReadonlyArray<Message>) =>
  Effect.gen(function* () {
    let next = running;
    for (const each of messages) {
      next = (yield* send(next, each)).running;
    }
    return next;
  });

const openScanStep = (): Effect.Effect<Running, unknown, never> =>
  Effect.gen(function* () {
    const opened = yield* send(
      { model: loaded({ _tag: "Disabled" }), waits: [] },
      enrollment(MfaEnrollment.Message.ClickedEnable()),
    );
    return yield* sendAll(
      opened.running,
      enrollment(
        MfaEnrollment.Message.SucceededEnrollMfa({
          ...requestedEnrollMfa(opened.commands),
          enrollment: ENROLLMENT,
        }),
      ),
    );
  });

const copy = (running: Running) =>
  sendAll(
    running,
    enrollment(
      MfaEnrollment.Message.GotCopyResultMessage({
        message: CopyResult.Message.ClickedCopy({ text: Redacted.make("copied text") }),
      }),
    ),
  );

const nextThenBack = (running: Running) =>
  sendAll(
    running,
    enrollment(MfaEnrollment.Message.ClickedNext()),
    enrollment(MfaEnrollment.Message.ClickedBack()),
  );

const closeThenReopen = (running: Running) =>
  Effect.gen(function* () {
    const closed = yield* sendAll(
      running,
      enrollment(MfaEnrollment.Message.GotDialogMessage({ message: { _tag: "RequestedClose" } })),
    );
    return (yield* send(closed, enrollment(MfaEnrollment.Message.ClickedEnable()))).running;
  });

const activate = (running: Running) =>
  Effect.gen(function* () {
    const typed = yield* sendAll(
      running,
      enrollment(MfaEnrollment.Message.ClickedNext()),
      enrollment(MfaEnrollment.Message.UpdatedCode({ value: "123456" })),
    );
    const submitted = yield* send(typed, enrollment(MfaEnrollment.Message.SubmittedCode()));
    return yield* sendAll(
      submitted.running,
      enrollment(
        MfaEnrollment.Message.SucceededActivateMfa(requestedActivation(submitted.commands)),
      ),
    );
  });

const requestedActivation = (commands: ReadonlyArray<AnyCommand>) => {
  const found = commands.find((command) => command.name === MfaEnrollment.ActivateMfa.name);
  if (found === undefined) {
    throw new Error("ActivateMfa was not requested");
  }
  const { visit, requestNumber } = found.args as { visit: number; requestNumber: number };
  return { visit, requestNumber };
};

const runWithTestClock = <A>(effect: Effect.Effect<A, unknown, never>): Promise<A> =>
  Effect.runPromise(Effect.scoped(effect).pipe(Effect.provide(TestClock.layer())));

const showsDialogText = (model: Model, label: string, present: boolean) =>
  scene(
    { update, view },
    given(model),
    Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
    Command.resolveAll(...pendingDialogTransitionResolvers(model.enrollment.dialog)),
    expect(role("heading", { name: DIALOG_TITLE })).toExist(),
    present ? expect(text(label)).toExist() : expect(text(label)).toBeAbsent(),
  );

const shows = (model: Model, label: string) => showsDialogText(model, label, true);

const hides = (model: Model, label: string) => showsDialogText(model, label, false);

describe("MFA の有効化の dialog のコピーの結果の表示", () => {
  let clipboardWrites: () => Promise<void> = () => Promise.resolve();
  const originalClipboard = Object.getOwnPropertyDescriptor(globalThis.navigator, "clipboard");

  beforeAll(() => {
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => clipboardWrites() },
    });
  });

  afterAll(() => {
    if (originalClipboard === undefined) {
      Reflect.deleteProperty(globalThis.navigator, "clipboard");
    } else {
      Object.defineProperty(globalThis.navigator, "clipboard", originalClipboard);
    }
  });

  test("QR の段階でコピーに成功した後に次へと戻るを押すと、「コピーしました」が出ていない", async () => {
    clipboardWrites = () => Promise.resolve();
    const returned = await runWithTestClock(
      Effect.gen(function* () {
        const copied = yield* copy(yield* openScanStep());
        shows(copied.model, COPIED);
        return (yield* nextThenBack(yield* advance(copied, 1000))).model;
      }),
    );
    expectBun(returned.enrollment.step._tag).toBe("Scan");
    hides(returned, COPIED);
  });

  test("QR の段階でコピーに失敗した後に次へと戻るを押すと、「コピーできませんでした」が出ていない", async () => {
    clipboardWrites = () => Promise.reject(new Error("denied"));
    const returned = await runWithTestClock(
      Effect.gen(function* () {
        const failed = yield* copy(yield* openScanStep());
        shows(failed.model, NOT_COPIED);
        return (yield* nextThenBack(yield* advance(failed, 1000))).model;
      }),
    );
    clipboardWrites = () => Promise.resolve();
    expectBun(returned.enrollment.step._tag).toBe("Scan");
    hides(returned, NOT_COPIED);
  });

  test("QR の段階でコピーに成功した後に有効化が通ると、リカバリーコードの段階に「コピーしました」が出ていない", async () => {
    clipboardWrites = () => Promise.resolve();
    const activated = await runWithTestClock(
      Effect.gen(function* () {
        const copied = yield* copy(yield* openScanStep());
        return (yield* activate(yield* advance(copied, 1000))).model;
      }),
    );
    expectBun(activated.enrollment.step._tag).toBe("RecoveryCodes");
    shows(activated, "リカバリーコードをコピー");
    hides(activated, COPIED);
  });

  test("リカバリーコードの段階でコピーした後に閉じて開き直すと、読み込み中と QR の段階に「コピーしました」が出ていない", async () => {
    clipboardWrites = () => Promise.resolve();
    const result = await runWithTestClock(
      Effect.gen(function* () {
        const activated = yield* activate(yield* openScanStep());
        const copied = yield* copy(activated);
        shows(copied.model, COPIED);
        const closed = yield* sendAll(
          yield* advance(copied, 1000),
          enrollment(MfaEnrollment.Message.ClickedCloseAfterSavingCodes()),
        );
        const reopened = yield* send(closed, enrollment(MfaEnrollment.Message.ClickedEnable()));
        const scanned = yield* sendAll(
          reopened.running,
          enrollment(
            MfaEnrollment.Message.SucceededEnrollMfa({
              ...requestedEnrollMfa(reopened.commands),
              enrollment: ENROLLMENT,
            }),
          ),
        );
        return { starting: reopened.running.model, scanned: scanned.model };
      }),
    );
    expectBun(result.starting.enrollment.step._tag).toBe("Starting");
    hides(result.starting, COPIED);
    expectBun(result.scanned.enrollment.step._tag).toBe("Scan");
    hides(result.scanned, COPIED);
  });

  test("コピーから 3 秒たつ直前は「コピーしました」が出ていて、3 秒たった直後は出ていない", async () => {
    clipboardWrites = () => Promise.resolve();
    const result = await runWithTestClock(
      Effect.gen(function* () {
        const copied = yield* copy(yield* openScanStep());
        const justBefore = yield* advance(copied, 2999);
        const justAfter = yield* advance(justBefore, 2);
        return { justBefore: justBefore.model, justAfter: justAfter.model };
      }),
    );
    shows(result.justBefore, COPIED);
    hides(result.justAfter, COPIED);
  });

  test("2 回コピーすると、1 回目から 3 秒たっても出ていて、2 回目から 3 秒たつと消える", async () => {
    clipboardWrites = () => Promise.resolve();
    const result = await runWithTestClock(
      Effect.gen(function* () {
        const first = yield* copy(yield* openScanStep());
        const second = yield* copy(yield* advance(first, 1000));
        const afterFirst = yield* advance(second, 2001);
        const afterSecond = yield* advance(afterFirst, 1000);
        return { afterFirst: afterFirst.model, afterSecond: afterSecond.model };
      }),
    );
    shows(result.afterFirst, COPIED);
    hides(result.afterSecond, COPIED);
  });

  test("次へと戻るの後にもう一度コピーすると、1 回目から 3 秒たっても出ていて、2 回目から 3 秒たつと消える", async () => {
    clipboardWrites = () => Promise.resolve();
    const result = await runWithTestClock(
      Effect.gen(function* () {
        const first = yield* copy(yield* openScanStep());
        const returned = yield* nextThenBack(yield* advance(first, 500));
        const second = yield* copy(yield* advance(returned, 500));
        const afterFirst = yield* advance(second, 2001);
        const afterSecond = yield* advance(afterFirst, 1000);
        return { afterFirst: afterFirst.model, afterSecond: afterSecond.model };
      }),
    );
    expectBun(result.afterFirst.enrollment.step._tag).toBe("Scan");
    shows(result.afterFirst, COPIED);
    hides(result.afterSecond, COPIED);
  });

  test("閉じて開き直した QR の段階でもう一度コピーすると、1 回目から 3 秒たっても出ていて、2 回目から 3 秒たつと消える", async () => {
    clipboardWrites = () => Promise.resolve();
    const result = await runWithTestClock(
      Effect.gen(function* () {
        const first = yield* copy(yield* openScanStep());
        const reopened = yield* closeThenReopen(yield* advance(first, 500));
        const second = yield* copy(yield* advance(reopened, 500));
        const afterFirst = yield* advance(second, 2001);
        const afterSecond = yield* advance(afterFirst, 1000);
        return { afterFirst: afterFirst.model, afterSecond: afterSecond.model };
      }),
    );
    expectBun(result.afterFirst.enrollment.step._tag).toBe("Scan");
    shows(result.afterFirst, COPIED);
    hides(result.afterSecond, COPIED);
  });
});
