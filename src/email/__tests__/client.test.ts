import { afterEach, beforeEach, expect, type Mock, spyOn, test } from "bun:test";
import { Cause, Effect, Exit } from "effect";
import { EmailError } from "../../errors";
import { renderAndSendEmail } from "../client";

const RESEND_KEY = "AUTH_RESEND_KEY";
const keyBefore = process.env[RESEND_KEY];
let resendApi: Mock<typeof fetch>;

beforeEach(() => {
  process.env[RESEND_KEY] = "re_test";
  resendApi = spyOn(globalThis, "fetch");
});

afterEach(() => {
  resendApi.mockRestore();
  if (keyBefore === undefined) {
    delete process.env[RESEND_KEY];
  } else {
    process.env[RESEND_KEY] = keyBefore;
  }
});

const send = () =>
  Effect.runPromiseExit(
    renderAndSendEmail({
      from: "from@example.com",
      to: "to@example.com",
      subject: "subject",
      kind: "welcome",
      body: {
        appName: "app",
        preview: "preview",
        logo: "hidden",
        title: "title",
        intro: [],
        main: [],
        footer: [],
      },
    }),
  );

test("Resend が失敗の応答を返すと、reject しなくても送信は EmailError で失敗する", async () => {
  resendApi.mockResolvedValue(
    Response.json(
      { name: "validation_error", message: "invalid from", statusCode: 422 },
      { status: 422 },
    ),
  );

  const exit = await send();

  expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(EmailError);
});

test("Resend が成功の応答を返すと、送信は成功する", async () => {
  resendApi.mockResolvedValue(Response.json({ id: "email-1" }));

  expect(Exit.isSuccess(await send())).toBe(true);
});
