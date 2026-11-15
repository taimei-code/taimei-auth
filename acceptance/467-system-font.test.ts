import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { Effect } from "effect";

import { EmailSender } from "../src/email/ports";
import { toDisplayText } from "../src/email/sanitize";
import { EmailSenderLive } from "../src/email/wiring";

const REPO_ROOT = join(import.meta.dir, "..");
const EXTERNAL_FONT_HOSTS = String.raw`fonts\.(googleapis|gstatic)\.com`;

const ENV = {
  AUTH_RESEND_KEY: "re_acceptance",
  APP_NAME: "taimei",
  AUTH_SERVICE_URL: "https://auth.example.com",
  AUTH_SUPPORT_EMAIL: "support@example.com",
  AUTH_ABUSE_INFO_URL: "https://example.com/security",
} as const;

const gitGrep = (pattern: string, ...pathspecs: string[]): string[] =>
  spawnSync("git", ["grep", "-n", "--untracked", "-E", pattern, "--", ...pathspecs], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  })
    .stdout.split("\n")
    .filter(Boolean);

let sentHtml: string[] = [];
const originalFetch = globalThis.fetch;
const originalEnv = Object.fromEntries(Object.keys(ENV).map((key) => [key, process.env[key]]));

beforeAll(() => {
  Object.assign(process.env, ENV);
  globalThis.fetch = (async (_input: unknown, init?: { body?: unknown }) => {
    sentHtml.push((JSON.parse(String(init?.body)) as { html: string }).html);
    return new Response(JSON.stringify({ id: "sent-1" }), {
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

const htmlOf = async (
  use: (sender: EmailSender["Service"]) => Effect.Effect<void, unknown>,
): Promise<string> => {
  sentHtml = [];
  await Effect.runPromise(
    Effect.gen(function* () {
      yield* use(yield* EmailSender);
    }).pipe(Effect.provide(EmailSenderLive)),
  );
  expect(sentHtml).toHaveLength(1);
  return sentHtml[0] ?? "";
};

const EMAILS: Array<{
  name: string;
  use: (sender: EmailSender["Service"]) => Effect.Effect<void, unknown>;
}> = [
  {
    name: "ログインリンク",
    use: (sender) =>
      sender.sendMagicLink("user@example.com", "https://auth.example.com/api/auth/verify"),
  },
  { name: "ようこそ", use: (sender) => sender.sendWelcome("user@example.com", toDisplayText("山田")) },
  {
    name: "招待",
    use: (sender) =>
      sender.sendInvitation({
        inviteeEmail: "invitee@example.com",
        url: "https://auth.example.com/api/auth/verify",
        companyName: toDisplayText("株式会社A"),
        inviterName: toDisplayText("佐藤"),
        inviterEmail: toDisplayText("sato@example.com"),
        roleLabel: "管理者",
      }),
  },
  { name: "MFA の有効化", use: (sender) => sender.sendMfaEnabled("user@example.com") },
  { name: "MFA の無効化", use: (sender) => sender.sendMfaDisabled("user@example.com") },
];

describe("外部の font を読まない (#467)", () => {
  test("AC-001: web・testing・src/email の source に Google Fonts の host を書かない。描画を止めず、画面とメールを開いた事実を第三者に送らないため", () => {
    expect(gitGrep(EXTERNAL_FONT_HOSTS, "web", "testing", "src/email")).toEqual([]);
  });

  test.each(EMAILS)(
    "AC-002: $name のメールの HTML は Google Fonts の host を読まない",
    async ({ use }) => {
      expect(await htmlOf(use)).not.toMatch(new RegExp(EXTERNAL_FONT_HOSTS));
    },
  );
});
