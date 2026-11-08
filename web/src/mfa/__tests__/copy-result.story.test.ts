import { describe, expect, test } from "bun:test";
import { Redacted } from "effect";
import { Command, given, message, model, story } from "foldkit/story";

import { CopyText, init, Message, update, WaitBeforeHidingCopyResult } from "../copy-result";

const SECRET = Redacted.make("JBSWY3DPEHPK3PXP");

describe("コピーの結果", () => {
  test("コピーに成功すると「コピーしました」を出し、待った後に消す", () => {
    story(
      update,
      given(init()),
      message(Message.ClickedCopy({ text: SECRET })),
      Command.resolve(CopyText, Message.SucceededCopyText()),
      model((next) => {
        expect(next.result._tag).toBe("Copied");
      }),
      Command.resolve(
        WaitBeforeHidingCopyResult,
        Message.CompletedWaitBeforeHidingCopyResult({ shownNumber: 1 }),
      ),
      model((next) => {
        expect(next.result._tag).toBe("Idle");
      }),
    );
  });

  test("コピーに失敗すると「コピーできませんでした」を出す", () => {
    story(
      update,
      given(init()),
      message(Message.ClickedCopy({ text: SECRET })),
      Command.resolve(CopyText, Message.FailedCopyText()),
      model((next) => {
        expect(next.result._tag).toBe("NotCopied");
      }),
      Command.resolve(
        WaitBeforeHidingCopyResult,
        Message.CompletedWaitBeforeHidingCopyResult({ shownNumber: 1 }),
      ),
    );
  });

  test("古いコピーの結果を隠す合図は、新しいコピーの結果を消さない", () => {
    const shownTwice = update(
      update(init(), Message.SucceededCopyText()).model,
      Message.SucceededCopyText(),
    ).model;
    expect(
      update(shownTwice, Message.CompletedWaitBeforeHidingCopyResult({ shownNumber: 1 })).model
        .result._tag,
    ).toBe("Copied");
  });
});
