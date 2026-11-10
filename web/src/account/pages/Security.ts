import { Effect, Number, Option, Schema } from "effect";
import { Command, Submodel, Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { defineTaggedUnion } from "foldkit/schema";
import { modifyFields } from "foldkit/struct";

import { isDialogVisible } from "../../shared/ui/dialog-view";
import * as MfaDisabling from "../../mfa/mfa-disabling";
import * as MfaEnrollment from "../../mfa/mfa-enrollment";
import { SpaHttpClient } from "../../shared/spa-http-client";
import { alertTextView } from "../../shared/ui/alert-text-view";
import { badgeVariants } from "../../shared/ui/class-names";
import { listLoadingStatusView } from "../../shared/ui/icon-view";
import { NoticeTone, ReloadTexts, staleNoticeOf } from "../../shared/ui/toast-view";
import { accountPageHeaderView } from "../account-page-header-view";

const MfaState = defineTaggedUnion({
  Loading: {},
  Failed: {},
  Disabled: {},
  Enabled: { recoveryCodesRemaining: Schema.Int },
});
type MfaRegistration = typeof MfaState.Disabled.Type | typeof MfaState.Enabled.Type;

export const Model = Schema.Struct({
  visit: Schema.Int,
  mfa: MfaState,
  refreshNumber: Schema.Int,
  enrollment: MfaEnrollment.Model,
  disabling: MfaDisabling.Model,
});
export type Model = typeof Model.Type;

const LoadFailure = Schema.Literals(["Unauthorized", "Unexpected"]);

export const Message = defineMessageUnion({
  SucceededLoadMfaStatus: {
    visit: Schema.Int,
    refreshNumber: Schema.Int,
    mfa: MfaState,
    maybeTexts: Schema.Option(ReloadTexts),
  },
  FailedLoadMfaStatus: {
    visit: Schema.Int,
    refreshNumber: Schema.Int,
    failure: LoadFailure,
    maybeTexts: Schema.Option(ReloadTexts),
  },
  GotMfaEnrollmentMessage: { message: MfaEnrollment.Message },
  GotMfaDisablingMessage: { message: MfaDisabling.Message },
});
export type Message = typeof Message.Type;

export const OutMessage = defineMessageUnion({
  Notified: { tone: NoticeTone, text: Schema.String },
  RequiredSignIn: {},
});
export type OutMessage = typeof OutMessage.Type;

const STATUS_UNAVAILABLE = "多要素認証 (MFA) の設定状態を取得できませんでした。";

const AFTER_ENABLING: ReloadTexts = {
  doneText: "多要素認証 (MFA) を有効にしました。",
  actionText: "多要素認証 (MFA) を有効にしました",
};

const AFTER_DISABLING: ReloadTexts = {
  doneText: "多要素認証 (MFA) を無効にしました。",
  actionText: "多要素認証 (MFA) を無効にしました",
};

const LOW_RECOVERY_CODE_THRESHOLD = 3;

const failedLoadMfaStatus =
  (
    visit: number,
    refreshNumber: number,
    maybeTexts: Option.Option<ReloadTexts>,
    failure: typeof LoadFailure.Type,
  ) =>
  () =>
    Effect.succeed(Message.FailedLoadMfaStatus({ visit, refreshNumber, failure, maybeTexts }));

export const LoadMfaStatus = Command.define("LoadMfaStatus", {
  args: {
    visit: Schema.Int,
    refreshNumber: Schema.Int,
    maybeTexts: Schema.Option(ReloadTexts),
  },
  messages: [Message.SucceededLoadMfaStatus, Message.FailedLoadMfaStatus],
  execute: ({ visit, refreshNumber, maybeTexts }) =>
    Effect.gen(function* () {
      const client = yield* SpaHttpClient;
      const status = yield* client.mfa.status();
      return Message.SucceededLoadMfaStatus({
        visit,
        refreshNumber,
        maybeTexts,
        mfa: status.enabled
          ? MfaState.Enabled({ recoveryCodesRemaining: status.recovery_codes_remaining })
          : MfaState.Disabled(),
      });
    }).pipe(
      Effect.catchTags({
        Unauthorized: failedLoadMfaStatus(visit, refreshNumber, maybeTexts, "Unauthorized"),
        HttpClientError: failedLoadMfaStatus(visit, refreshNumber, maybeTexts, "Unexpected"),
        SchemaError: failedLoadMfaStatus(visit, refreshNumber, maybeTexts, "Unexpected"),
      }),
    ),
});

export const init = (visit: number): Update.Return<Model, Message, SpaHttpClient> => ({
  model: {
    visit,
    mfa: MfaState.Loading(),
    refreshNumber: 0,
    enrollment: MfaEnrollment.init(),
    disabling: MfaDisabling.init(),
  },
  commands: [LoadMfaStatus({ visit, refreshNumber: 0, maybeTexts: Option.none() })],
});

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, SpaHttpClient>;
type Step = Update.StepWithOutMessage<Model, Message, OutMessage, SpaHttpClient>;

const reloadMfaStatus =
  (texts: ReloadTexts): Step =>
  (model) => {
    const requested = modifyFields(model, { refreshNumber: Number.increment });
    return {
      model: requested,
      commands: [
        LoadMfaStatus({
          visit: requested.visit,
          refreshNumber: requested.refreshNumber,
          maybeTexts: Option.some(texts),
        }),
      ],
    };
  };

const forThisRefresh = (
  model: Model,
  visit: number,
  refreshNumber: number,
  next: () => UpdateReturn,
): UpdateReturn =>
  visit === model.visit && refreshNumber === model.refreshNumber ? next() : { model };

const failLoad = (
  model: Model,
  failure: typeof LoadFailure.Type,
  maybeTexts: Option.Option<ReloadTexts>,
): UpdateReturn =>
  failure === "Unauthorized"
    ? { model, outMessage: OutMessage.RequiredSignIn() }
    : Option.match(maybeTexts, {
        onNone: () => ({ model: modifyFields(model, { mfa: () => MfaState.Failed() }) }),
        onSome: ({ actionText }) => ({
          model,
          outMessage: OutMessage.Notified({
            tone: "Error",
            text: staleNoticeOf(actionText),
          }),
        }),
      });

const foldMfaEnrollment = Update.foldChild({
  update: MfaEnrollment.update,
  read: (model: Model) => Option.some(model.enrollment),
  write: (model: Model, nextEnrollment: MfaEnrollment.Model) =>
    modifyFields(model, { enrollment: () => nextEnrollment }),
  toParentMessage: (message: MfaEnrollment.Message) => Message.GotMfaEnrollmentMessage({ message }),
  foldOutMessage: MfaEnrollment.OutMessage.match<Step>({
    ClosedAfterEnabling: () => reloadMfaStatus(AFTER_ENABLING),
    RequiredSignIn: () => (model) => ({ model, outMessage: OutMessage.RequiredSignIn() }),
  }),
});

const foldMfaDisabling = Update.foldChild({
  update: MfaDisabling.update,
  read: (model: Model) => Option.some(model.disabling),
  write: (model: Model, nextDisabling: MfaDisabling.Model) =>
    modifyFields(model, { disabling: () => nextDisabling }),
  toParentMessage: (message: MfaDisabling.Message) => Message.GotMfaDisablingMessage({ message }),
  foldOutMessage: MfaDisabling.OutMessage.match<Step>({
    Disabled: () => reloadMfaStatus(AFTER_DISABLING),
    RequiredSignIn: () => (model) => ({ model, outMessage: OutMessage.RequiredSignIn() }),
  }),
});

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    SucceededLoadMfaStatus: ({ visit, refreshNumber, mfa, maybeTexts }) =>
      forThisRefresh(model, visit, refreshNumber, () => {
        const loaded = modifyFields(model, { mfa: () => mfa });
        return Option.match(maybeTexts, {
          onNone: () => ({ model: loaded }),
          onSome: ({ doneText }) => ({
            model: loaded,
            outMessage: OutMessage.Notified({ tone: "Success", text: doneText }),
          }),
        });
      }),
    FailedLoadMfaStatus: ({ visit, refreshNumber, failure, maybeTexts }) =>
      forThisRefresh(model, visit, refreshNumber, () => failLoad(model, failure, maybeTexts)),
    GotMfaEnrollmentMessage: ({ message: enrollmentMessage }) =>
      foldMfaEnrollment(model, enrollmentMessage),
    GotMfaDisablingMessage: ({ message: disablingMessage }) =>
      foldMfaDisabling(model, disablingMessage),
  });

const describeRecoveryCodeShortage = (remaining: number): string =>
  remaining === 0
    ? "リカバリーコードを使い切りました。認証アプリを使えなくなるとログインできなくなります (再発行の導線はありません)。"
    : "リカバリーコードの残りが少なくなっています。使い切ると、認証アプリを失った時にログインできなくなります (再発行の導線はありません)。";

const badgeView = (label: string, variant: "default" | "secondary", h: HtmlBuilder<Message>) =>
  h.span([h.Class(`${badgeVariants({ variant })} shrink-0`)], [label]);

const recoveryCodesRemainingView = (remaining: number, h: HtmlBuilder<Message>) => [
  h.p([h.Class("mt-2 text-sm text-muted-foreground")], [`リカバリーコードの残り: ${remaining} 個`]),
  ...(remaining <= LOW_RECOVERY_CODE_THRESHOLD
    ? [h.p([h.Class("mt-1 text-sm text-destructive")], [describeRecoveryCodeShortage(remaining)])]
    : []),
];

const enrollmentView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: "mfa-enrollment",
    view: MfaEnrollment.view,
    model: model.enrollment,
    toParentMessage: (message) => Message.GotMfaEnrollmentMessage({ message }),
  });

const disablingView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: "mfa-disabling",
    view: MfaDisabling.view,
    model: model.disabling,
    toParentMessage: (message) => Message.GotMfaDisablingMessage({ message }),
  });

const mfaRowView = (model: Model, registration: MfaRegistration, h: HtmlBuilder<Message>): Html =>
  h.li(
    [h.Class("flex items-start justify-between gap-4 py-5")],
    [
      h.div(
        [],
        [
          h.p([h.Class("font-medium")], ["多要素認証 (MFA)"]),
          h.p(
            [h.Class("mt-1 text-sm text-muted-foreground")],
            ["認証アプリ (TOTP) を登録すると、ログイン時に確認コードの入力を求めます"],
          ),
          ...MfaState.matchOrElse(
            registration,
            {
              Enabled: ({ recoveryCodesRemaining }) =>
                recoveryCodesRemainingView(recoveryCodesRemaining, h),
            },
            () => [],
          ),
        ],
      ),
      h.div(
        [h.Class("flex shrink-0 items-center gap-3")],
        MfaState.matchOrElse(
          registration,
          {
            Enabled: () => [
              badgeView("有効", "default", h),
              disablingView(model, h),
              ...(isDialogVisible(model.enrollment.dialog) ? [enrollmentView(model, h)] : []),
            ],
          },
          () => [badgeView("無効", "secondary", h), enrollmentView(model, h)],
        ),
      ),
    ],
  );

const passkeyRowView = (h: HtmlBuilder<Message>): Html =>
  h.li(
    [h.Class("flex items-start justify-between gap-4 py-5")],
    [
      h.div(
        [],
        [
          h.p([h.Class("font-medium")], ["Passkey"]),
          h.p(
            [h.Class("mt-1 text-sm text-muted-foreground")],
            ["指紋・顔認証・PIN でログインできます"],
          ),
        ],
      ),
      badgeView("実装予定", "secondary", h),
    ],
  );

const mfaListView = (model: Model, registration: MfaRegistration, h: HtmlBuilder<Message>): Html =>
  h.ul([h.Class("divide-y")], [mfaRowView(model, registration, h), passkeyRowView(h)]);

const mfaStateView = (model: Model, h: HtmlBuilder<Message>): Html =>
  MfaState.match(model.mfa, {
    Loading: () => listLoadingStatusView("読み込み中…", h),
    Failed: () => alertTextView(STATUS_UNAVAILABLE, h),
    Disabled: (disabled) => mfaListView(model, disabled, h),
    Enabled: (enabled) => mfaListView(model, enabled, h),
  });

export const view = Submodel.defineView<Model, Message>((model, h) =>
  h.div(
    [],
    [
      ...accountPageHeaderView("セキュリティ", "認証方法とセキュリティ設定", h),
      mfaStateView(model, h),
    ],
  ),
);
