import { Effect, Number, Option, Schema } from "effect";
import { Command, Submodel, Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { defineTaggedUnion } from "foldkit/schema";
import { modifyFields } from "foldkit/struct";

import { isDialogVisible } from "../../shared/ui/dialog-view";
import * as MfaDisabling from "../../mfa/mfa-disabling";
import * as MfaEnrollment from "../../mfa/mfa-enrollment";
import * as PasskeySettings from "../../passkey/passkey-settings";
import { contractFailure, messageOnFailure } from "../../shared/spa-contract-failure";
import { SpaHttpClient } from "../../shared/spa-http-client";
import { alertTextView } from "../../shared/ui/alert-text-view";
import { settingRowView } from "../../shared/ui/setting-row-view";
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
  passkeyList: PasskeySettings.PasskeyList,
  passkeySettings: PasskeySettings.Model,
});
export type Model = typeof Model.Type;

const LoadFailure = contractFailure(["Unauthorized"]);

export const Message = defineMessageUnion({
  SucceededLoadSecuritySettings: {
    visit: Schema.Int,
    refreshNumber: Schema.Int,
    mfa: MfaState,
    passkeyList: PasskeySettings.PasskeyList,
    maybeTexts: Schema.Option(ReloadTexts),
  },
  FailedLoadSecuritySettings: {
    visit: Schema.Int,
    refreshNumber: Schema.Int,
    failure: LoadFailure,
    maybeTexts: Schema.Option(ReloadTexts),
  },
  GotMfaEnrollmentMessage: { message: MfaEnrollment.Message },
  GotMfaDisablingMessage: { message: MfaDisabling.Message },
  GotPasskeySettingsMessage: { message: PasskeySettings.Message },
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

const AFTER_REGISTERING_PASSKEY: ReloadTexts = {
  doneText: "パスキーを登録しました。",
  actionText: "パスキーを登録しました",
};

const AFTER_DELETING_PASSKEY: ReloadTexts = {
  doneText: "パスキーを削除しました。",
  actionText: "パスキーを削除しました",
};

const LOW_RECOVERY_CODE_THRESHOLD = 3;

export const LoadSecuritySettings = Command.define("LoadSecuritySettings", {
  args: {
    visit: Schema.Int,
    refreshNumber: Schema.Int,
    maybeTexts: Schema.Option(ReloadTexts),
  },
  messages: [Message.SucceededLoadSecuritySettings, Message.FailedLoadSecuritySettings],
  execute: ({ visit, refreshNumber, maybeTexts }) =>
    Effect.gen(function* () {
      const client = yield* SpaHttpClient;
      const { status, passkeyList } = yield* Effect.all(
        {
          status: client.mfa.status(),
          passkeyList: PasskeySettings.loadPasskeyList(client.passkey),
        },
        { concurrency: "unbounded" },
      );
      return Message.SucceededLoadSecuritySettings({
        visit,
        refreshNumber,
        maybeTexts,
        passkeyList,
        mfa: status.enabled
          ? MfaState.Enabled({ recoveryCodesRemaining: status.recovery_codes_remaining })
          : MfaState.Disabled(),
      });
    }).pipe(
      messageOnFailure({
        failure: LoadFailure,
        asUnexpected: [],
        toMessage: (failure) =>
          Message.FailedLoadSecuritySettings({ visit, refreshNumber, failure, maybeTexts }),
      }),
    ),
});

export const init = (visit: number): Update.Return<Model, Message, SpaHttpClient> => ({
  model: {
    visit,
    mfa: MfaState.Loading(),
    refreshNumber: 0,
    enrollment: MfaEnrollment.init(visit),
    disabling: MfaDisabling.init(visit),
    passkeyList: PasskeySettings.PasskeyList.Hidden(),
    passkeySettings: PasskeySettings.init(visit),
  },
  commands: [LoadSecuritySettings({ visit, refreshNumber: 0, maybeTexts: Option.none() })],
});

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, SpaHttpClient>;
type Step = Update.StepWithOutMessage<Model, Message, OutMessage, SpaHttpClient>;

const reloadSecuritySettings =
  (texts: ReloadTexts): Step =>
  (model) => {
    const requested = modifyFields(model, { refreshNumber: Number.increment });
    return {
      model: requested,
      commands: [
        LoadSecuritySettings({
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

const forwarding =
  (outMessage: OutMessage): Step =>
  (model) => ({ model, outMessage });

const foldMfaEnrollment = Update.foldChild({
  update: MfaEnrollment.update,
  read: (model: Model) => Option.some(model.enrollment),
  write: (model: Model, nextEnrollment: MfaEnrollment.Model) =>
    modifyFields(model, { enrollment: () => nextEnrollment }),
  toParentMessage: (message: MfaEnrollment.Message) => Message.GotMfaEnrollmentMessage({ message }),
  foldOutMessage: MfaEnrollment.OutMessage.match<Step>({
    ClosedAfterEnabling: () => reloadSecuritySettings(AFTER_ENABLING),
    RequiredSignIn: () => forwarding(OutMessage.RequiredSignIn()),
  }),
});

const foldMfaDisabling = Update.foldChild({
  update: MfaDisabling.update,
  read: (model: Model) => Option.some(model.disabling),
  write: (model: Model, nextDisabling: MfaDisabling.Model) =>
    modifyFields(model, { disabling: () => nextDisabling }),
  toParentMessage: (message: MfaDisabling.Message) => Message.GotMfaDisablingMessage({ message }),
  foldOutMessage: MfaDisabling.OutMessage.match<Step>({
    Disabled: () => reloadSecuritySettings(AFTER_DISABLING),
    RequiredSignIn: () => forwarding(OutMessage.RequiredSignIn()),
  }),
});

const toPasskeySettingsMessage = (message: PasskeySettings.Message) =>
  Message.GotPasskeySettingsMessage({ message });

const foldPasskeySettings = Update.foldChild({
  update: PasskeySettings.update,
  read: (model: Model) => Option.some(model.passkeySettings),
  write: (model: Model, nextPasskeys: PasskeySettings.Model) =>
    modifyFields(model, { passkeySettings: () => nextPasskeys }),
  toParentMessage: toPasskeySettingsMessage,
  foldOutMessage: PasskeySettings.OutMessage.match<Step>({
    Registered: () => reloadSecuritySettings(AFTER_REGISTERING_PASSKEY),
    Deleted: () => reloadSecuritySettings(AFTER_DELETING_PASSKEY),
    Notified: (notice) => forwarding(OutMessage.Notified(notice)),
    RequiredSignIn: () => forwarding(OutMessage.RequiredSignIn()),
  }),
});

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    SucceededLoadSecuritySettings: ({ visit, refreshNumber, mfa, passkeyList, maybeTexts }) =>
      forThisRefresh(model, visit, refreshNumber, () => {
        const loaded = modifyFields(model, { mfa: () => mfa, passkeyList: () => passkeyList });
        return Option.match(maybeTexts, {
          onNone: () => ({ model: loaded }),
          onSome: ({ doneText }) => ({
            model: loaded,
            outMessage: OutMessage.Notified({ tone: "Success", text: doneText }),
          }),
        });
      }),
    FailedLoadSecuritySettings: ({ visit, refreshNumber, failure, maybeTexts }) =>
      forThisRefresh(model, visit, refreshNumber, () => failLoad(model, failure, maybeTexts)),
    GotMfaEnrollmentMessage: ({ message: enrollmentMessage }) =>
      foldMfaEnrollment(model, enrollmentMessage),
    GotMfaDisablingMessage: ({ message: disablingMessage }) =>
      foldMfaDisabling(model, disablingMessage),
    GotPasskeySettingsMessage: ({ message: passkeySettingsMessage }) =>
      foldPasskeySettings(model, passkeySettingsMessage),
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
  settingRowView(
    {
      title: "多要素認証 (MFA)",
      description: "認証アプリ (TOTP) を登録すると、ログイン時に確認コードの入力を求めます",
      details: MfaState.matchOrElse(
        registration,
        {
          Enabled: ({ recoveryCodesRemaining }) =>
            recoveryCodesRemainingView(recoveryCodesRemaining, h),
        },
        () => [],
      ),
      actions: MfaState.matchOrElse(
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
    },
    h,
  );

const passkeySettingsView = (model: Model, mfaEnabled: boolean, h: HtmlBuilder<Message>): Html =>
  h.submodel({
    slotId: "passkey-settings",
    view: PasskeySettings.view,
    model: model.passkeySettings,
    viewInputs: { list: model.passkeyList, mfaEnabled },
    toParentMessage: toPasskeySettingsMessage,
  });

const mfaListView = (model: Model, registration: MfaRegistration, h: HtmlBuilder<Message>): Html =>
  h.ul(
    [h.Role("list"), h.Class("divide-y")],
    [
      mfaRowView(model, registration, h),
      passkeySettingsView(model, MfaState.guards.Enabled(registration), h),
    ],
  );

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
