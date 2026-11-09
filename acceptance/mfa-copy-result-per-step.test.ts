import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Fiber, Option, Redacted } from "effect";
import { TestClock } from "effect/testing";
import { expect as expectView, given, Mount, role, scene, text } from "foldkit/scene";

import { init, Message, type Model, update, view } from "../web/src/account/pages/Security";
import * as CopyResult from "../web/src/mfa/copy-result";
import * as MfaEnrollment from "../web/src/mfa/mfa-enrollment";
import { Dialog } from "../web/src/shared/ui/dialog-view";

const REPO_ROOT = join(import.meta.dir, "..");

const ENROLLMENT = {
  enrollmentId: "enrollment-1",
  totpUri: Redacted.make("otpauth://totp/taimei:me?secret=JBSWY3DPEHPK3PXP"),
  recoveryCodes: Redacted.make(["aaaaa-11111", "bbbbb-22222"]),
};

const COPIED = "コピーしました";
const NOT_COPIED = "コピーできませんでした";

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

type Running = { model: Model; waits: Array<Fiber.Fiber<unknown, unknown>> };

type AnyCommand = { name: string; args?: unknown; effect: Effect.Effect<unknown, unknown, unknown> };

const enrollment = (message: MfaEnrollment.Message): Message =>
  Message.GotMfaEnrollmentMessage({ message });

const loadedDisabled = (): Model =>
  update(
    init(1).model,
    Message.SucceededLoadMfaStatus({
      visit: 1,
      refreshNumber: 0,
      mfa: { _tag: "Disabled" },
      maybeTexts: Option.none(),
    }),
  ).model;

const requestNumberOf = (commands: ReadonlyArray<AnyCommand>, name: string): number => {
  const found = commands.find((command) => command.name === name);
  if (found === undefined) {
    throw new Error(`${name} was not requested`);
  }
  return (found.args as { requestNumber: number }).requestNumber;
};

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
      const exit = fiber.pollUnsafe();
      if (exit !== undefined) {
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
    for (const message of messages) {
      next = (yield* send(next, message)).running;
    }
    return next;
  });

const openScanStep = (): Effect.Effect<Running, unknown, never> =>
  Effect.gen(function* () {
    const opened = yield* send(
      { model: loadedDisabled(), waits: [] },
      enrollment(MfaEnrollment.Message.ClickedEnable()),
    );
    const requestNumber = requestNumberOf(opened.commands, MfaEnrollment.EnrollMfa.name);
    return yield* sendAll(
      opened.running,
      enrollment(
        MfaEnrollment.Message.SucceededEnrollMfa({ requestNumber, enrollment: ENROLLMENT }),
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
    const requestNumber = requestNumberOf(submitted.commands, MfaEnrollment.ActivateMfa.name);
    return yield* sendAll(
      submitted.running,
      enrollment(MfaEnrollment.Message.SucceededActivateMfa({ requestNumber })),
    );
  });

const runWithTestClock = <A>(effect: Effect.Effect<A, unknown, never>): Promise<A> =>
  Effect.runPromise(Effect.scoped(effect).pipe(Effect.provide(TestClock.layer())));

const DIALOG_TITLE = "多要素認証 (MFA) を有効にする";

const passes = (check: () => void): boolean => {
  try {
    check();
    return true;
  } catch {
    return false;
  }
};

const shows = (model: Model, label: string): boolean =>
  passes(() =>
    scene(
      { update, view },
      given(model),
      Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
      expectView(text(label)).toExist(),
    ),
  );

const hides = (model: Model, label: string): boolean =>
  passes(() =>
    scene(
      { update, view },
      given(model),
      Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
      expectView(role("heading", { name: DIALOG_TITLE })).toExist(),
      expectView(text(label)).toBeAbsent(),
    ),
  );

describe("MFA の有効化の dialog のコピーの結果", () => {
  test("AC-001: QR の段階でコピーに成功した後に次へと戻るを押すと、「コピーしました」が出ていない", async () => {
    clipboardWrites = () => Promise.resolve();
    const result = await runWithTestClock(
      Effect.gen(function* () {
        const copied = yield* copy(yield* openScanStep());
        const shownBefore = shows(copied.model, COPIED);
        const returned = yield* nextThenBack(yield* advance(copied, 1000));
        return { shownBefore, returned: returned.model };
      }),
    );
    expect(result.shownBefore).toBe(true);
    expect(result.returned.enrollment.step._tag).toBe("Scan");
    expect(hides(result.returned, COPIED)).toBe(true);
  });

  test("AC-002: QR の段階でコピーに失敗した後に次へと戻るを押すと、「コピーできませんでした」が出ていない", async () => {
    clipboardWrites = () => Promise.reject(new Error("denied"));
    const result = await runWithTestClock(
      Effect.gen(function* () {
        const failed = yield* copy(yield* openScanStep());
        const shownBefore = shows(failed.model, NOT_COPIED);
        const returned = yield* nextThenBack(yield* advance(failed, 1000));
        return { shownBefore, returned: returned.model };
      }),
    );
    clipboardWrites = () => Promise.resolve();
    expect(result.shownBefore).toBe(true);
    expect(result.returned.enrollment.step._tag).toBe("Scan");
    expect(hides(result.returned, NOT_COPIED)).toBe(true);
  });

  test("AC-003: QR の段階でコピーに成功した後に有効化が通ると、リカバリーコードの段階に「コピーしました」が出ていない", async () => {
    clipboardWrites = () => Promise.resolve();
    const activated = await runWithTestClock(
      Effect.gen(function* () {
        const copied = yield* copy(yield* openScanStep());
        return (yield* activate(yield* advance(copied, 1000))).model;
      }),
    );
    expect(activated.enrollment.step._tag).toBe("RecoveryCodes");
    expect(shows(activated, "リカバリーコードをコピー")).toBe(true);
    expect(hides(activated, COPIED)).toBe(true);
  });

  test("AC-004: リカバリーコードの段階でコピーした後に閉じて開き直すと、読み込み中と QR の段階に「コピーしました」が出ていない", async () => {
    clipboardWrites = () => Promise.resolve();
    const result = await runWithTestClock(
      Effect.gen(function* () {
        const activated = yield* activate(yield* openScanStep());
        const copied = yield* copy(activated);
        const shownBefore = shows(copied.model, COPIED);
        const closed = yield* sendAll(
          yield* advance(copied, 1000),
          enrollment(MfaEnrollment.Message.ClickedCloseAfterSavingCodes()),
        );
        const reopened = yield* send(closed, enrollment(MfaEnrollment.Message.ClickedEnable()));
        const requestNumber = requestNumberOf(reopened.commands, MfaEnrollment.EnrollMfa.name);
        const scanned = yield* sendAll(
          reopened.running,
          enrollment(
            MfaEnrollment.Message.SucceededEnrollMfa({ requestNumber, enrollment: ENROLLMENT }),
          ),
        );
        return { shownBefore, starting: reopened.running.model, scanned: scanned.model };
      }),
    );
    expect(result.shownBefore).toBe(true);
    expect(result.starting.enrollment.step._tag).toBe("Starting");
    expect(hides(result.starting, COPIED)).toBe(true);
    expect(result.scanned.enrollment.step._tag).toBe("Scan");
    expect(hides(result.scanned, COPIED)).toBe(true);
  });

  test("AC-005: コピーから 3 秒たつ直前は「コピーしました」が出ていて、3 秒たった直後は出ていない", async () => {
    clipboardWrites = () => Promise.resolve();
    const result = await runWithTestClock(
      Effect.gen(function* () {
        const copied = yield* copy(yield* openScanStep());
        const justBefore = yield* advance(copied, 2999);
        const justAfter = yield* advance(justBefore, 2);
        return { justBefore: justBefore.model, justAfter: justAfter.model };
      }),
    );
    expect(shows(result.justBefore, COPIED)).toBe(true);
    expect(hides(result.justAfter, COPIED)).toBe(true);
  });

  test("AC-006: 2 回コピーすると、1 回目から 3 秒たっても出ていて、2 回目から 3 秒たつと消える", async () => {
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
    expect(shows(result.afterFirst, COPIED)).toBe(true);
    expect(hides(result.afterSecond, COPIED)).toBe(true);
  });

  test("AC-007: 次へと戻るの後にもう一度コピーすると、1 回目から 3 秒たっても出ていて、2 回目から 3 秒たつと消える", async () => {
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
    expect(result.afterFirst.enrollment.step._tag).toBe("Scan");
    expect(shows(result.afterFirst, COPIED)).toBe(true);
    expect(hides(result.afterSecond, COPIED)).toBe(true);
  });

  test("AC-008: 閉じて開き直した QR の段階でもう一度コピーすると、1 回目から 3 秒たっても出ていて、2 回目から 3 秒たつと消える", async () => {
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
    expect(result.afterFirst.enrollment.step._tag).toBe("Scan");
    expect(shows(result.afterFirst, COPIED)).toBe(true);
    expect(hides(result.afterSecond, COPIED)).toBe(true);
  });
});

describe("MFA の有効化の dialog の Story テスト", () => {
  test("AC-009: Story テストに、QR の段階でコピーしてから次へと戻るを通す test がある", () => {
    const listed = spawnSync(
      "git",
      [
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "--",
        ":(glob)web/src/**/*.story.test.ts",
      ],
      { cwd: REPO_ROOT, encoding: "utf8" },
    )
      .stdout.split("\n")
      .filter((line) => line !== "");
    const matching = listed.filter((path) => {
      const source = readFileSync(join(REPO_ROOT, path), "utf8");
      return (
        source.includes("foldkit/story") &&
        source.includes("ClickedCopy") &&
        source.includes("ClickedNext") &&
        source.includes("ClickedBack")
      );
    });
    expect(matching.length).toBeGreaterThan(0);
  });
});
