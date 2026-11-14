import { Effect, Schema } from "effect";
import { Command, Submodel, type Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { defineTaggedUnion } from "foldkit/schema";
import { modifyFields } from "foldkit/struct";
import { ShieldCheck } from "lucide";

import { authPageCardView } from "../../auth/auth-page-card-view";
import { SpaHttpClient } from "../../shared/spa-http-client";
import { maybeRejectedMessage, Submission } from "../../shared/submission";
import { buttonLinkView, buttonView } from "../../shared/ui/button-view";
import { textLinkClassName } from "../../shared/ui/class-names";
import { loadingStatusView } from "../../shared/ui/icon-view";
import { inputView, maybeInputErrorView } from "../../shared/ui/input-view";
import {
  MFA_CODE_PASTE_TOLERANT_MAX_LENGTH,
  MFA_CODE_TEXTS,
  normalizeMfaCode,
  MfaCodeKindSchema,
  otherMfaCodeKind,
} from "../mfa-code";
import { mfaFailureText } from "../mfa-failure-messages";

const VerifyFailure = Schema.Literals([
  "ChallengeExpired",
  "InvalidCode",
  "Locked",
  "RateLimited",
  "Unexpected",
]);
type VerifyFailure = typeof VerifyFailure.Type;

const Phase = defineTaggedUnion({
  Observing: {},
  Entering: { kind: MfaCodeKindSchema, code: Schema.String, submission: Submission },
  Expired: {},
  Leaving: {},
});
type Phase = typeof Phase.Type;
type Entering = typeof Phase.Entering.Type;

export const Model = Schema.Struct({
  visit: Schema.Int,
  signInHref: Schema.String,
  phase: Phase,
});
export type Model = typeof Model.Type;

export const Message = defineMessageUnion({
  SucceededLoadChallengeState: { visit: Schema.Int, isPending: Schema.Boolean },
  FailedLoadChallengeState: { visit: Schema.Int },
  UpdatedCode: { value: Schema.String },
  ClickedToggleCodeKind: {},
  SubmittedCode: {},
  SucceededVerifyCode: { visit: Schema.Int, redirectUrl: Schema.String },
  FailedVerifyCode: { visit: Schema.Int, failure: VerifyFailure },
});
export type Message = typeof Message.Type;

export const OutMessage = defineMessageUnion({
  PassedChallenge: { redirectUrl: Schema.String },
});
export type OutMessage = typeof OutMessage.Type;

const CODE_INPUT_ID = "mfa-challenge-code";
const NEEDS_CHALLENGE_DESCRIPTION = "ログインを完了するには、追加の確認が必要です";

export const LoadChallengeState = Command.define("LoadChallengeState", {
  args: { visit: Schema.Int },
  messages: [Message.SucceededLoadChallengeState, Message.FailedLoadChallengeState],
  execute: ({ visit }) =>
    Effect.gen(function* () {
      const client = yield* SpaHttpClient;
      const { pending } = yield* client.mfaChallenge.state();
      return Message.SucceededLoadChallengeState({ visit, isPending: pending });
    }).pipe(
      Effect.catchTags({
        RateLimited: () => Effect.succeed(Message.FailedLoadChallengeState({ visit })),
        HttpClientError: () => Effect.succeed(Message.FailedLoadChallengeState({ visit })),
        SchemaError: () => Effect.succeed(Message.FailedLoadChallengeState({ visit })),
      }),
    ),
});

const failedVerify = (visit: number, failure: VerifyFailure) => () =>
  Effect.succeed(Message.FailedVerifyCode({ visit, failure }));

export const VerifyCode = Command.define("VerifyCode", {
  args: { visit: Schema.Int, code: Schema.String, kind: MfaCodeKindSchema },
  messages: [Message.SucceededVerifyCode, Message.FailedVerifyCode],
  execute: ({ visit, code, kind }) =>
    Effect.gen(function* () {
      const client = yield* SpaHttpClient;
      const { redirect_url } = yield* client.mfaChallenge.verify({ payload: { code, kind } });
      return Message.SucceededVerifyCode({ visit, redirectUrl: redirect_url });
    }).pipe(
      Effect.catchTags({
        ChallengeExpired: failedVerify(visit, "ChallengeExpired"),
        InvalidCode: failedVerify(visit, "InvalidCode"),
        Locked: failedVerify(visit, "Locked"),
        RateLimited: failedVerify(visit, "RateLimited"),
        HttpClientError: failedVerify(visit, "Unexpected"),
        SchemaError: failedVerify(visit, "Unexpected"),
      }),
    ),
});

export const init = (
  start: Readonly<{ visit: number; signInHref: string }>,
): Update.Return<Model, Message, SpaHttpClient> => ({
  model: { ...start, phase: Phase.Observing() },
  commands: [LoadChallengeState({ visit: start.visit })],
});

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, SpaHttpClient>;

const startEntering = (): Phase =>
  Phase.Entering({ kind: "totp", code: "", submission: Submission.Idle() });

const withEntering = (model: Model, next: (entering: Entering) => UpdateReturn): UpdateReturn =>
  Phase.matchOrElse(model.phase, { Entering: next }, () => ({ model }));

const whileEditable = (model: Model, next: (entering: Entering) => UpdateReturn): UpdateReturn =>
  withEntering(model, (entering) =>
    Submission.guards.Submitting(entering.submission) ? { model } : next(entering),
  );

const forThisVisit = (model: Model, visit: number, next: () => UpdateReturn): UpdateReturn =>
  visit === model.visit ? next() : { model };

const withPhase = (model: Model, phase: Phase): Model =>
  modifyFields(model, { phase: () => phase });

const finishObserving = (model: Model, visit: number, nextPhase: Phase): UpdateReturn =>
  forThisVisit(model, visit, () =>
    Phase.matchOrElse(
      model.phase,
      { Observing: () => ({ model: withPhase(model, nextPhase) }) },
      () => ({ model }),
    ),
  );

const submitCode = (model: Model): UpdateReturn =>
  whileEditable(model, (entering) => {
    const code = normalizeMfaCode(entering.code, entering.kind);
    return code === ""
      ? { model }
      : {
          model: withPhase(
            model,
            modifyFields(entering, { submission: () => Submission.Submitting() }),
          ),
          commands: [VerifyCode({ visit: model.visit, code, kind: entering.kind })],
        };
  });

const failVerify = (model: Model, failure: VerifyFailure): UpdateReturn =>
  withEntering(model, (entering) =>
    failure === "ChallengeExpired"
      ? { model: withPhase(model, Phase.Expired()) }
      : {
          model: withPhase(
            model,
            modifyFields(entering, {
              submission: () => Submission.Rejected({ message: mfaFailureText(failure) }),
            }),
          ),
        },
  );

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    SucceededLoadChallengeState: ({ visit, isPending }) =>
      finishObserving(model, visit, isPending ? startEntering() : Phase.Expired()),
    FailedLoadChallengeState: ({ visit }) => finishObserving(model, visit, startEntering()),
    UpdatedCode: ({ value }) =>
      whileEditable(model, (entering) => ({
        model: withPhase(model, modifyFields(entering, { code: () => value })),
      })),
    ClickedToggleCodeKind: () =>
      whileEditable(model, (entering) => ({
        model: withPhase(
          model,
          Phase.Entering({
            kind: otherMfaCodeKind(entering.kind),
            code: "",
            submission: Submission.Idle(),
          }),
        ),
      })),
    SubmittedCode: () => submitCode(model),
    SucceededVerifyCode: ({ visit, redirectUrl }) =>
      forThisVisit(model, visit, () =>
        withEntering(model, () => ({
          model: withPhase(model, Phase.Leaving()),
          outMessage: OutMessage.PassedChallenge({ redirectUrl }),
        })),
      ),
    FailedVerifyCode: ({ visit, failure }) =>
      forThisVisit(model, visit, () => failVerify(model, failure)),
  });

const expiredView = (model: Model, h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
  h.p(
    [h.Class("text-sm text-muted-foreground")],
    ["セッションの有効期限が切れました。お手数ですが、もう一度ログインしてください。"],
  ),
  buttonLinkView({ label: "ログイン画面へ", href: model.signInHref }, h),
];

const enteringView = (
  model: Model,
  entering: Entering,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => {
  const texts = MFA_CODE_TEXTS[entering.kind];
  const maybeErrorMessage = maybeRejectedMessage(entering.submission);
  const isSubmitting = Submission.guards.Submitting(entering.submission);
  return [
    h.form(
      [h.Class("space-y-3"), h.OnSubmit(Message.SubmittedCode())],
      [
        inputView(
          {
            id: CODE_INPUT_ID,
            label: texts.label,
            type: "text",
            value: entering.code,
            onInput: (value) => Message.UpdatedCode({ value }),
            submission: entering.submission,
            placeholder: texts.placeholder,
            autocomplete: "one-time-code",
            inputMode: texts.inputMode,
            maxLength: MFA_CODE_PASTE_TOLERANT_MAX_LENGTH,
            isAutoCorrectionOff: true,
            hint: { text: texts.hint, maybeErrorMessage },
          },
          h,
        ),
        buttonView(
          {
            label: "ログインを続ける",
            type: "submit",
            look: "primary",
            submission: entering.submission,
            isBlocked: normalizeMfaCode(entering.code, entering.kind) === "",
            icon: ShieldCheck,
          },
          h,
        ),
      ],
    ),
    h.div(
      [h.Class("text-center")],
      [
        buttonView(
          {
            label: texts.toggleLabel,
            type: "button",
            look: "subtleLink",
            submission: Submission.Idle(),
            isBlocked: isSubmitting,
            onClick: Message.ClickedToggleCodeKind(),
          },
          h,
        ),
      ],
    ),
    h.p(
      [h.Class("text-center text-sm text-muted-foreground")],
      [
        "認証アプリもリカバリーコードも使えない場合は ",
        h.a([h.Href(model.signInHref), h.Class(textLinkClassName)], ["ログインをやり直す"]),
      ],
    ),
    ...maybeInputErrorView(CODE_INPUT_ID, maybeErrorMessage, h),
  ];
};

export const view = Submodel.defineView<Model, Message>((model, h) =>
  authPageCardView(
    {
      title: "多要素認証 (MFA)",
      description: Phase.guards.Expired(model.phase)
        ? "ログインをやり直してください"
        : NEEDS_CHALLENGE_DESCRIPTION,
      width: "sm",
      content: Phase.match(model.phase, {
        Observing: () => [loadingStatusView("読み込み中…", h)],
        Entering: (entering) => enteringView(model, entering, h),
        Expired: () => expiredView(model, h),
        Leaving: () => [loadingStatusView("ログインを完了しています…", h)],
      }),
    },
    h,
  ),
);
