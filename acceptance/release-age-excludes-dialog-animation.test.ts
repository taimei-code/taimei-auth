import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { Animation, Dialog as FoldkitDialog } from "@foldkit/ui";
import { Option, Redacted } from "effect";
import {
  click,
  Command,
  expect as expectView,
  given,
  Mount,
  role,
  scene,
} from "foldkit/scene";

import { init, Message, type Model, update, view } from "../web/src/account/pages/Security";
import * as MfaEnrollment from "../web/src/mfa/mfa-enrollment";

const REPO_ROOT = join(import.meta.dir, "..");

const SPAWN_TIMEOUT_MS = 300_000;

const { NODE_ENV: _testRunnerNodeEnv, ...shellEnv } = process.env;

const run = (command: string, args: readonly string[]) =>
  spawnSync(command, [...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: shellEnv,
    timeout: SPAWN_TIMEOUT_MS,
  });

const gitGrep = (pattern: string, ...pathspecs: string[]): string[] =>
  run("git", ["grep", "-n", "-E", "--untracked", pattern, "--", ...pathspecs])
    .stdout.split("\n")
    .filter((line) => line !== "");

const PACKAGES_EXCLUDED_BY_383 = String.raw`^[[:space:]]*"(effect|@effect/platform-(bun|node|node-shared)|alchemy|@alchemy\.run/(cloudflare|acme|cloudflare-runtime|docker|node-utils|sql)|@distilled\.cloud/(acme|aws|aws4signer|cloudflare|core|iceberg))",?[[:space:]]*$`;

const DOMAIN_DIRS = ["account", "app", "auth", "company", "invitation", "membership", "mfa"].map(
  (domain) => `web/src/${domain}`,
);

const DIALOG_TITLE = "多要素認証 (MFA) を有効にする";

const FIRST_OPENING = 1;
const FIRST_CLOSING = 2;

const transitionSettles = (generation: number) =>
  [
    [Animation.WaitForPaint, Animation.Message.CompletedWaitForPaint({ generation })],
    [Animation.WaitForAnimationSettled, Animation.Message.EndedAnimation({ generation })],
  ] as const;

const ENROLLMENT = {
  enrollmentId: "enrollment-1",
  totpUri: Redacted.make("otpauth://totp/taimei:me?secret=JBSWY3DPEHPK3PXP"),
  recoveryCodes: Redacted.make(["aaaaa-11111", "bbbbb-22222"]),
};

const enrollment = (message: MfaEnrollment.Message): Message =>
  Message.GotMfaEnrollmentMessage({ message });

const requestNumberOfEnrollMfa = (commands: ReadonlyArray<{ name: string; args?: unknown }>) => {
  const enrollMfa = commands.find((command) => command.name === MfaEnrollment.EnrollMfa.name);
  if (enrollMfa === undefined) {
    throw new Error("EnrollMfa was not requested");
  }
  return (enrollMfa.args as { requestNumber: number }).requestNumber;
};

const enrollmentDialogShowingSecret = (): Model => {
  const loaded = update(
    init(1).model,
    Message.SucceededLoadMfaStatus({
      visit: 1,
      refreshNumber: 0,
      mfa: { _tag: "Disabled" },
      maybeTexts: Option.none(),
    }),
  ).model;
  const opened = update(loaded, enrollment(MfaEnrollment.Message.ClickedEnable()));
  return update(
    opened.model,
    enrollment(
      MfaEnrollment.Message.SucceededEnrollMfa({
        requestNumber: requestNumberOfEnrollMfa(opened.commands ?? []),
        enrollment: ENROLLMENT,
      }),
    ),
  ).model;
};

describe("minimumReleaseAge の例外 (#385)", () => {
  test("AC-001: bunfig.toml に、#383 が足した package の名前を例外として書かない", () => {
    expect(gitGrep(PACKAGES_EXCLUDED_BY_383, "bunfig.toml")).toEqual([]);
  });

  test(
    "AC-002: lockfile を固定した install が通る",
    () => {
      const installed = run("bun", ["install", "--frozen-lockfile", "--dry-run"]);
      expect(installed.status).toBe(0);
    },
    SPAWN_TIMEOUT_MS,
  );
});

describe("dialog の開閉の animation (#424)", () => {
  test("AC-004: dialog を閉じる操作の後、閉じる animation が終わるまで中身を描き、終わると消す", () => {
    scene(
      { update, view },
      given(enrollmentDialogShowingSecret()),
      Mount.resolve(
        FoldkitDialog.AcquireResources,
        FoldkitDialog.Message.SucceededAcquireResources(),
      ),
      Command.resolveAll(...transitionSettles(FIRST_OPENING)),
      expectView(role("heading", { name: DIALOG_TITLE })).toExist(),
      click(role("button", { name: "Close" })),
      expectView(role("heading", { name: DIALOG_TITLE })).toExist(),
      Command.resolveAll(...transitionSettles(FIRST_CLOSING), [
        FoldkitDialog.CloseDialog,
        FoldkitDialog.Message.CompletedCloseDialog(),
      ]),
      expectView(role("heading", { name: DIALOG_TITLE })).toBeAbsent(),
      Mount.expectEnded(FoldkitDialog.AcquireResources),
    );
  });

  test("AC-008: 画面の domain の code に isAnimated を書かない", () => {
    expect(gitGrep("isAnimated", ...DOMAIN_DIRS)).toEqual([]);
  });

  test(
    "AC-009: web の Story テストと Scene テストが通る",
    () => {
      const tested = run("bun", ["test", "web/src"]);
      expect(tested.status).toBe(0);
    },
    SPAWN_TIMEOUT_MS,
  );
});
