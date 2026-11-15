import { describe, expect, test } from "bun:test";
import { Effect, Exit, Layer, Option } from "effect";
import type { Command } from "foldkit";
import { given as givenScene, scene, tap } from "foldkit/scene";
import { fromString } from "foldkit/url";

import * as Security from "../web/src/account/pages/Security";
import { init, Message, type Model, update, view } from "../web/src/app/account/main";
import * as MfaDisabling from "../web/src/mfa/mfa-disabling";
import * as MfaEnrollment from "../web/src/mfa/mfa-enrollment";
import { SpaHttpClient } from "../web/src/shared/spa-http-client";

const ORIGIN = "https://auth.taimei-code.com";
const SECURITY = `${ORIGIN}/account/security`;
const PROFILE = `${ORIGIN}/account`;
const QR_STEP_TEXT = /認証アプリで QR コードを読み取ってください/;
const INVALID_CODE_TEXT = "入力されたコードが正しくありません。";

const urlOf = (href: string) =>
  Option.getOrThrowWith(fromString(href), () => new Error(`URL として読めない: ${href}`));

type AnyCommand = Command.Command<Message, unknown, unknown>;
type Step = { model: Model; commands: ReadonlyArray<AnyCommand> };

const COMPANY = {
  company_id: "company-a",
  company_name: "事業所A",
  company_org_code: "CORPORATE",
  role: "OWNER",
};

const ENROLLMENT = {
  enrollment_id: "enrollment-1",
  totp_uri: "otpauth://totp/taimei:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=taimei",
  recovery_codes: ["recovery-1"],
};

const clientWith = (mfaEnabled: boolean) => ({
  account: {
    memberships: () =>
      Effect.succeed({ current_company_id: COMPANY.company_id, memberships: [COMPANY] }),
  },
  mfa: {
    status: () =>
      Effect.succeed(
        mfaEnabled ? { enabled: true, recovery_codes_remaining: 8 } : { enabled: false },
      ),
    enroll: () => Effect.succeed(ENROLLMENT),
    disable: () => Effect.succeed(undefined),
  },
});

const rejectingDisable = {
  ...clientWith(true),
  mfa: {
    ...clientWith(true).mfa,
    disable: () => Effect.fail({ _tag: "InvalidCode" }),
  },
};

type FakeClient = ReturnType<typeof clientWith> | typeof rejectingDisable;

const executed = async (command: AnyCommand, client: FakeClient) => {
  const exit = await Effect.runPromiseExit(
    (command.effect as Effect.Effect<Message, unknown, SpaHttpClient>).pipe(
      Effect.provide(Layer.succeed(SpaHttpClient, client as never)),
      Effect.timeout("200 millis"),
    ),
  );
  return Exit.isSuccess(exit) ? Option.some(exit.value) : Option.none();
};

const dispatch = (model: Model, message: Message): Step => {
  const result = update(model, message);
  return { model: result.model, commands: (result.commands ?? []) as ReadonlyArray<AnyCommand> };
};

const settled = async (step: Step, client: FakeClient, depth = 4): Promise<Model> => {
  let model = step.model;
  for (const command of step.commands) {
    const maybeMessage = await executed(command, client);
    if (Option.isSome(maybeMessage)) {
      const next = dispatch(model, maybeMessage.value);
      model = depth > 0 ? await settled(next, client, depth - 1) : next.model;
    }
  }
  return model;
};

const deliver = (model: Model, held: ReadonlyArray<AnyCommand>, client: FakeClient) =>
  settled({ model, commands: held }, client);

const securityPage = async (client: FakeClient) => {
  const opened = init(urlOf(SECURITY));
  return settled(
    { model: opened.model, commands: opened.commands as ReadonlyArray<AnyCommand> },
    client,
  );
};

const rebuiltByBackAndForward = async (model: Model, client: FakeClient) => {
  const back = dispatch(model, Message.ChangedUrl({ url: urlOf(PROFILE) }));
  const atProfile = await settled(back, client);
  return settled(dispatch(atProfile, Message.ChangedUrl({ url: urlOf(SECURITY) })), client);
};

const enrollment = (message: MfaEnrollment.Message) =>
  Message.GotSecurityMessage({ message: Security.Message.GotMfaEnrollmentMessage({ message }) });

const disabling = (message: MfaDisabling.Message) =>
  Message.GotSecurityMessage({ message: Security.Message.GotMfaDisablingMessage({ message }) });

const requestEnrollment = (model: Model): Step =>
  dispatch(model, enrollment(MfaEnrollment.Message.ClickedEnable()));

const submitDisabling = (model: Model): Step => {
  const opened = dispatch(model, disabling(MfaDisabling.Message.ClickedDisable())).model;
  const typed = dispatch(opened, disabling(MfaDisabling.Message.UpdatedCode({ value: "123456" })))
    .model;
  return dispatch(typed, disabling(MfaDisabling.Message.SubmittedCode()));
};

type VNodeLike = { text?: string; children?: ReadonlyArray<VNodeLike | string> };

const textOf = (node: VNodeLike | string | undefined): string =>
  typeof node === "string"
    ? node
    : `${node?.text ?? ""}${(node?.children ?? []).map((child) => textOf(child)).join("")}`;

const STOP_AFTER_RENDER = new Error("rendered");

const renderedText = (model: Model): string => {
  let rendered = "";
  try {
    scene(
      { update, view },
      givenScene(model),
      tap(({ html }) => {
        rendered = textOf(html as VNodeLike);
        throw STOP_AFTER_RENDER;
      }),
    );
  } catch (error) {
    if (error !== STOP_AFTER_RENDER) throw error;
  }
  return rendered;
};

const expectText = (model: Model, target: string | RegExp, present: boolean) => {
  const rendered = renderedText(model);
  const found = typeof target === "string" ? rendered.includes(target) : target.test(rendered);
  expect(found).toBe(present);
};

describe("MFA の dialog が、作り直す前の page の応答を受けない (#460)", () => {
  test("AC-001: 有効化の要求の後に「戻る」「進む」でセキュリティを作り直し、新しい page で有効化を要求した後に前の page の応答が届いても、新しい dialog は QR コードの段に進まない", async () => {
    const client = clientWith(false);
    const first = requestEnrollment(await securityPage(client));
    const rebuilt = await rebuiltByBackAndForward(first.model, client);
    const second = requestEnrollment(rebuilt);

    const afterOldResponse = await deliver(second.model, first.commands, client);

    expectText(afterOldResponse, QR_STEP_TEXT, false);
  });

  test("AC-002: 同じ page で要求した有効化の応答が届くと、dialog は QR コードの段に進む", async () => {
    const client = clientWith(false);
    const first = requestEnrollment(await securityPage(client));
    const rebuilt = await rebuiltByBackAndForward(first.model, client);
    const second = requestEnrollment(rebuilt);

    const afterOwnResponse = await deliver(second.model, second.commands, client);

    expectText(afterOwnResponse, QR_STEP_TEXT, true);
  });

  test("AC-003: 無効化を送った後に「戻る」「進む」でセキュリティを作り直し、新しい page で無効化を送った後に前の page の失敗の応答が届いても、新しい dialog に誤りの文言は出ない", async () => {
    const first = submitDisabling(await securityPage(rejectingDisable));
    const rebuilt = await rebuiltByBackAndForward(first.model, clientWith(true));
    const second = submitDisabling(rebuilt);

    const afterOldResponse = await deliver(second.model, first.commands, rejectingDisable);

    expectText(afterOldResponse, INVALID_CODE_TEXT, false);
  });

  test("AC-004: 同じ page で送った無効化の失敗の応答が届くと、dialog に誤りの文言が出る", async () => {
    const first = submitDisabling(await securityPage(rejectingDisable));
    const rebuilt = await rebuiltByBackAndForward(first.model, rejectingDisable);
    const second = submitDisabling(rebuilt);

    const afterOwnResponse = await deliver(second.model, second.commands, rejectingDisable);

    expectText(afterOwnResponse, INVALID_CODE_TEXT, true);
  });
});
