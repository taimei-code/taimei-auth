import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { TestClock } from "effect/testing";

import { EmailSender } from "../src/email/ports";
import { toDisplayText } from "../src/email/sanitize";
import { EmailSenderLive } from "../src/email/wiring";

const REPO_ROOT = join(import.meta.dir, "..");
const EXPECTED_DIR = join(import.meta.dir, "email-without-react");
const SENT_IN_2026 = Date.UTC(2026, 5, 1);

const ENV = {
  AUTH_RESEND_KEY: "re_acceptance",
  APP_NAME: "taimei",
  AUTH_SERVICE_URL: "https://auth.example.com",
  AUTH_SUPPORT_EMAIL: "support@example.com",
  AUTH_ABUSE_INFO_URL: "https://example.com/security?a=1&b=2",
} as const;

type SentPayload = { to: string | string[]; subject: string; html: string; text: string };

let sent: SentPayload[] = [];
let resendFails = false;
const originalFetch = globalThis.fetch;
const originalEnv = Object.fromEntries(Object.keys(ENV).map((key) => [key, process.env[key]]));

beforeAll(() => {
  Object.assign(process.env, ENV);
  globalThis.fetch = (async (_input: unknown, init?: { body?: unknown }) => {
    sent.push(JSON.parse(String(init?.body)) as SentPayload);
    return resendFails
      ? new Response(
          JSON.stringify({ statusCode: 422, name: "validation_error", message: "rejected" }),
          { status: 422, headers: { "content-type": "application/json" } },
        )
      : new Response(JSON.stringify({ id: "sent-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const send = async (
  use: (sender: EmailSender["Service"]) => Effect.Effect<void, unknown>,
): Promise<SentPayload> => {
  sent = [];
  resendFails = false;
  await Effect.runPromise(
    Effect.gen(function* () {
      yield* TestClock.setTime(SENT_IN_2026);
      yield* use(yield* EmailSender);
    }).pipe(Effect.provide(EmailSenderLive), Effect.provide(TestClock.layer())),
  );
  expect(sent).toHaveLength(1);
  return sent[0]!;
};

const REACT_TEXT_BOUNDARY_COMMENTS = /<!--(?: |\$|\/\$|html|head|body)-->/g;
const withoutReactBoundaryComments = (html: string) =>
  html.replace(REACT_TEXT_BOUNDARY_COMMENTS, "");

const expectSameAsBefore = (payload: SentPayload, name: string, to: string, subject: string) => {
  expect(payload.to).toEqual(to);
  expect(payload.subject).toBe(subject);
  expect(withoutReactBoundaryComments(payload.html)).toBe(
    withoutReactBoundaryComments(readFileSync(join(EXPECTED_DIR, `${name}.html`), "utf8")),
  );
  expect(payload.text).toBe(readFileSync(join(EXPECTED_DIR, `${name}.txt`), "utf8"));
};

const MAGIC_LINK_URL = "https://auth.example.com/api/auth/magic-link/verify?token=a&b=<c>";
const INVITATION_URL = "https://auth.example.com/api/auth/magic-link/verify?token=x&y=1";
const INVITATION = {
  inviteeEmail: "invitee+<x>@example.com",
  url: INVITATION_URL,
  companyName: toDisplayText(`<script>"株式会社&'"`),
  inviterName: toDisplayText("佐藤 <i>"),
  inviterEmail: toDisplayText("sato+a@example.com"),
  roleLabel: "管理者",
};
const WELCOME_NAME = `山田 <b>"&'`;

const gitGrep = (pattern: string, ...pathspecs: string[]): string[] => {
  const result = spawnSync(
    "git",
    ["grep", "-n", "--untracked", "-E", pattern, "--", ...pathspecs],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  return result.stdout.split("\n").filter(Boolean);
};

const SOURCE_DIRS = ["src", "web", "testing", "e2e", "packages"];

describe("repo は React に依存しない", () => {
  test("AC-001: package.json に react・react-dom・@types/react・@react-email の依存が無い", () => {
    expect(
      gitGrep(
        String.raw`"(react|react-dom|@types/react|@react-email/[^"]+)"[[:space:]]*:`,
        "package.json",
        "packages/*/package.json",
      ),
    ).toEqual([]);
  });

  test("AC-002: source は react・react-dom・@react-email を import しない", () => {
    expect(
      gitGrep(
        String.raw`(^[[:space:]]*(import|export)[[:space:]][^"']*|^[[:space:]]*\}[[:space:]]*from[[:space:]]+|(await|=>)[[:space:]]*import\([[:space:]]*)["'](react|react-dom|@react-email/[^"']+)(/[^"']*)?["']`,
        ...SOURCE_DIRS,
      ),
    ).toEqual([]);
  });

  test("AC-003: source に JSX を書く .tsx の file が無い", () => {
    const result = spawnSync(
      "git",
      [
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "--",
        ...SOURCE_DIRS.map((dir) => `${dir}/**/*.tsx`),
        ...SOURCE_DIRS.map((dir) => `${dir}/*.tsx`),
      ],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    expect(result.stdout.split("\n").filter(Boolean)).toEqual([]);
  });

  test("AC-012: 起動時に初期化される prismjs が lockfile に無い", () => {
    expect(gitGrep('"prismjs@', "bun.lock")).toEqual([]);
  });
});

describe("各メールの件名と本文は移す前と同じ", () => {
  test("AC-004: magic link のメールは移す前と同じ件名・宛先・HTML・text を送る", async () => {
    const payload = await send((sender) => sender.sendMagicLink("user@example.com", MAGIC_LINK_URL));
    expectSameAsBefore(payload, "magic-link", "user@example.com", "taimei へのログインリンク");
  });

  test("AC-005: 表示名のある welcome のメールは移す前と同じ件名・宛先・HTML・text を送る", async () => {
    const payload = await send((sender) =>
      sender.sendWelcome("user@example.com", toDisplayText(WELCOME_NAME)),
    );
    expectSameAsBefore(payload, "welcome", "user@example.com", "taimei へようこそ！");
  });

  test("AC-006: 表示名が空の welcome のメールは移す前と同じ件名・宛先・HTML・text を送る", async () => {
    const payload = await send((sender) =>
      sender.sendWelcome("user@example.com", toDisplayText("")),
    );
    expectSameAsBefore(payload, "welcome-no-name", "user@example.com", "taimei へようこそ！");
  });

  test("AC-007: 招待のメールは移す前と同じ件名・宛先・HTML・text を送る", async () => {
    const payload = await send((sender) => sender.sendInvitation(INVITATION));
    expectSameAsBefore(
      payload,
      "invitation",
      "invitee+<x>@example.com",
      `[taimei] 佐藤 <i> さんから「<script>"株式会社&'"」への招待`,
    );
  });

  test("AC-008: MFA の有効化の通知は移す前と同じ件名・宛先・HTML・text を送る", async () => {
    const payload = await send((sender) => sender.sendMfaEnabled("user@example.com"));
    expectSameAsBefore(
      payload,
      "mfa-enabled",
      "user@example.com",
      "[taimei] 多要素認証 (MFA) を有効にしました",
    );
  });

  test("AC-009: MFA の無効化の通知は移す前と同じ件名・宛先・HTML・text を送る", async () => {
    const payload = await send((sender) => sender.sendMfaDisabled("user@example.com"));
    expectSameAsBefore(
      payload,
      "mfa-disabled",
      "user@example.com",
      "[taimei] 多要素認証 (MFA) を無効にしました",
    );
  });
});

describe("利用者の入力はエスケープして本文に出す", () => {
  test("AC-010: 招待の事業所名・招待者名・招待先の tag は HTML に tag のまま出ず、text には文字として出る", async () => {
    const payload = await send((sender) => sender.sendInvitation(INVITATION));
    for (const raw of ["<script>", "<i>", "<x>"]) {
      expect(payload.html).not.toContain(raw);
      expect(payload.text).toContain(raw);
    }
  });

  test("AC-011: welcome の表示名の tag は HTML に tag のまま出ない", async () => {
    const payload = await send((sender) =>
      sender.sendWelcome("user@example.com", toDisplayText(WELCOME_NAME)),
    );
    expect(payload.html).not.toContain("<b>");
  });
});

describe("送信の失敗", () => {
  test("AC-013: Resend の API が失敗を返すと、送信は EmailError で失敗する", async () => {
    sent = [];
    resendFails = true;
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const sender = yield* EmailSender;
        return yield* Effect.flip(sender.sendMfaEnabled("user@example.com"));
      }).pipe(Effect.provide(EmailSenderLive), Effect.provide(TestClock.layer())),
    );
    expect(error._tag).toBe("EmailError");
    expect(sent).toHaveLength(1);
  });
});
