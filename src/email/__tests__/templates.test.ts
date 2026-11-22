import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  type Mock,
  setSystemTime,
  spyOn,
  test,
} from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";

import { EmailSender } from "../ports";
import { toDisplayText } from "../sanitize";
import { EmailSenderLive } from "../wiring";

const EXPECTED_DIR = join(import.meta.dir, "__fixtures__", "expected");
const SENT_IN_2026 = new Date(Date.UTC(2026, 5, 1));
const EXTERNAL_FONT_HOSTS = /fonts\.(googleapis|gstatic)\.com/;

const ENV = {
  AUTH_RESEND_KEY: "re_test",
  APP_NAME: "taimei",
  AUTH_SERVICE_URL: "https://auth.example.com",
  AUTH_SUPPORT_EMAIL: "support@example.com",
  AUTH_ABUSE_INFO_URL: "https://example.com/security?a=1&b=2",
} as const;

type SentPayload = { to: string | string[]; subject: string; html: string; text: string };

let sent: SentPayload[] = [];
let resendApi: Mock<typeof fetch>;
const originalEnv = Object.fromEntries(Object.keys(ENV).map((key) => [key, process.env[key]]));

beforeAll(() => {
  Object.assign(process.env, ENV);
});

afterAll(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(() => {
  sent = [];
  setSystemTime(SENT_IN_2026);
  resendApi = spyOn(globalThis, "fetch").mockImplementation((async (
    _input: unknown,
    init?: { body?: unknown },
  ) => {
    sent.push(JSON.parse(String(init?.body)) as SentPayload);
    return Response.json({ id: "sent-1" });
  }) as typeof fetch);
});

afterEach(() => {
  resendApi.mockRestore();
  setSystemTime();
});

type Use = (sender: EmailSender["Service"]) => Effect.Effect<void, unknown>;

const send = async (use: Use): Promise<SentPayload> => {
  await Effect.runPromise(
    Effect.gen(function* () {
      yield* use(yield* EmailSender);
    }).pipe(Effect.provide(EmailSenderLive)),
  );
  expect(sent).toHaveLength(1);
  return sent[0]!;
};

const BOUNDARY_COMMENTS = /<!--(?: |\$|\/\$|html|head|body)-->/g;
const withoutBoundaryComments = (html: string) => html.replace(BOUNDARY_COMMENTS, "");

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

const EMAILS: {
  name: string;
  fixture: string;
  to: string;
  subject: string;
  use: Use;
}[] = [
  {
    name: "magic link",
    fixture: "magic-link",
    to: "user@example.com",
    subject: "taimei へのログインリンク",
    use: (sender) => sender.sendMagicLink("user@example.com", MAGIC_LINK_URL),
  },
  {
    name: "表示名のある welcome",
    fixture: "welcome",
    to: "user@example.com",
    subject: "taimei へようこそ！",
    use: (sender) => sender.sendWelcome("user@example.com", toDisplayText(WELCOME_NAME)),
  },
  {
    name: "表示名が空の welcome",
    fixture: "welcome-no-name",
    to: "user@example.com",
    subject: "taimei へようこそ！",
    use: (sender) => sender.sendWelcome("user@example.com", toDisplayText("")),
  },
  {
    name: "招待",
    fixture: "invitation",
    to: "invitee+<x>@example.com",
    subject: `[taimei] 佐藤 <i> さんから「<script>"株式会社&'"」への招待`,
    use: (sender) => sender.sendInvitation(INVITATION),
  },
  {
    name: "MFA の有効化の通知",
    fixture: "mfa-enabled",
    to: "user@example.com",
    subject: "[taimei] 多要素認証 (MFA) を有効にしました",
    use: (sender) => sender.sendMfaEnabled("user@example.com"),
  },
  {
    name: "MFA の無効化の通知",
    fixture: "mfa-disabled",
    to: "user@example.com",
    subject: "[taimei] 多要素認証 (MFA) を無効にしました",
    use: (sender) => sender.sendMfaDisabled("user@example.com"),
  },
  {
    name: "パスキーの登録の通知",
    fixture: "passkey-registered",
    to: "user@example.com",
    subject: "[taimei] パスキーを登録しました",
    use: (sender) =>
      sender.sendPasskeyChanged({
        change: "registered",
        email: "user@example.com",
        providerName: "Google パスワードマネージャー",
      }),
  },
  {
    name: "提供元が表に無いパスキーの削除の通知",
    fixture: "passkey-deleted-unknown-provider",
    to: "user@example.com",
    subject: "[taimei] パスキーを削除しました",
    use: (sender) =>
      sender.sendPasskeyChanged({
        change: "deleted",
        email: "user@example.com",
        providerName: null,
      }),
  },
];

describe("各メールは、期待の file と同じ件名・宛先・HTML・text を送る", () => {
  test.each(EMAILS)("$name のメールは、件名・宛先・HTML・text が期待の file と同じ", async ({
    fixture,
    to,
    subject,
    use,
  }) => {
    const payload = await send(use);

    expect(payload.to).toEqual(to);
    expect(payload.subject).toBe(subject);
    expect(withoutBoundaryComments(payload.html)).toBe(
      withoutBoundaryComments(readFileSync(join(EXPECTED_DIR, `${fixture}.html`), "utf8")),
    );
    expect(payload.text).toBe(readFileSync(join(EXPECTED_DIR, `${fixture}.txt`), "utf8"));
  });
});

describe("利用者の入力はエスケープして本文に出す", () => {
  test("招待の事業所名・招待者名・招待先の tag は HTML に tag のまま出ず、text には文字として出る", async () => {
    const payload = await send((sender) => sender.sendInvitation(INVITATION));

    for (const raw of ["<script>", "<i>", "<x>"]) {
      expect(payload.html).not.toContain(raw);
      expect(payload.text).toContain(raw);
    }
  });

  test("パスキーの通知の提供元の名前の tag は HTML に tag のまま出ず、text には文字として出る", async () => {
    const payload = await send((sender) =>
      sender.sendPasskeyChanged({
        change: "registered",
        email: "user@example.com",
        providerName: "<b>提供元</b>",
      }),
    );

    expect(payload.html).not.toContain("<b>提供元</b>");
    expect(payload.text).toContain("<b>提供元</b>");
  });

  test("welcome の表示名の tag は HTML に tag のまま出ない", async () => {
    const payload = await send((sender) =>
      sender.sendWelcome("user@example.com", toDisplayText(WELCOME_NAME)),
    );

    expect(payload.html).not.toContain("<b>");
  });
});

describe("外部の font を読まない", () => {
  test.each(EMAILS)("$name のメールの HTML は Google Fonts の host を読まない", async ({ use }) => {
    expect((await send(use)).html).not.toMatch(EXTERNAL_FONT_HOSTS);
  });
});
