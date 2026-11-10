import { Effect, Match, Option, Schema } from "effect";
import { Command, Submodel, Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { modifyFields } from "foldkit/struct";
import { Check } from "lucide";

import { orgCodeLabelJa } from "@core/company/org-code";
import { roleLabelJa } from "@core/membership/role-label";

import * as CurrentCompany from "../../account/current-company";
import { pageTitleView, separatorView } from "../../account/account-page-header-view";
import { readSignedInUserId } from "../../auth/sign-in-client";
import * as OwnershipTransfer from "../../membership/ownership-transfer";
import { SpaHttpClient } from "../../shared/spa-http-client";
import { Submission } from "../../shared/submission";
import { buttonView } from "../../shared/ui/button-view";
import { iconView } from "../../shared/ui/icon-view";
import { NoticeTone } from "../../shared/ui/toast-view";
import * as AddCompany from "../add-company";

export const Model = Schema.Struct({
  visit: Schema.Int,
  maybeSelfUserId: Schema.Option(Schema.String),
  leaving: Submission,
  maybeSoleOwnerCompanyId: Schema.Option(Schema.String),
  addCompany: AddCompany.Model,
  ownershipTransfer: OwnershipTransfer.Model,
});
export type Model = typeof Model.Type;

const LeaveCompanyFailure = Schema.Literals(["LastOwner", "Unauthorized", "Unexpected"]);

export const Message = defineMessageUnion({
  CompletedReadSignedInUserId: { visit: Schema.Int, maybeUserId: Schema.Option(Schema.String) },
  ClickedSwitchCompany: { companyId: Schema.String },
  ClickedLeaveCompany: { membership: CurrentCompany.Membership },
  SucceededLeaveCompany: { visit: Schema.Int, companyName: Schema.String },
  SucceededLeaveLastCompany: {},
  FailedLeaveCompany: { visit: Schema.Int, companyId: Schema.String, failure: LeaveCompanyFailure },
  ClickedTransferOwnership: { membership: CurrentCompany.Membership },
  GotAddCompanyMessage: { message: AddCompany.Message },
  GotOwnershipTransferMessage: { message: OwnershipTransfer.Message },
});
export type Message = typeof Message.Type;

export const isLastCompanyLeft = Schema.is(Message.SucceededLeaveLastCompany);

export const OutMessage = defineMessageUnion({
  Notified: { tone: NoticeTone, text: Schema.String },
  RequiredSignIn: {},
  UpdatedCompanyState: { texts: CurrentCompany.RefreshTexts },
  SelectedCompany: { companyId: Schema.String },
});
export type OutMessage = typeof OutMessage.Type;

type ViewInputs = Readonly<{ currentCompany: CurrentCompany.Model }>;

const LEAVE_FAILED = "事業所から抜けられませんでした。";

const SOLE_OWNER_CANNOT_LEAVE =
  "唯一のオーナーは事業所から抜けられません。先にオーナーを委譲してください。";

export const ReadSignedInUserId = Command.define("ReadSignedInUserId", {
  args: { visit: Schema.Int },
  messages: [Message.CompletedReadSignedInUserId],
  execute: ({ visit }) =>
    readSignedInUserId.pipe(
      Effect.map((maybeUserId) => Message.CompletedReadSignedInUserId({ visit, maybeUserId })),
      Effect.catchTag("UnknownError", () =>
        Effect.succeed(Message.CompletedReadSignedInUserId({ visit, maybeUserId: Option.none() })),
      ),
    ),
});

const failedLeave =
  (visit: number, companyId: string, failure: typeof LeaveCompanyFailure.Type) => () =>
    Effect.succeed(Message.FailedLeaveCompany({ visit, companyId, failure }));

export const LeaveCompany = Command.define("LeaveCompany", {
  args: {
    visit: Schema.Int,
    membership: CurrentCompany.Membership,
    selfUserId: Schema.String,
  },
  messages: [
    Message.SucceededLeaveCompany,
    Message.SucceededLeaveLastCompany,
    Message.FailedLeaveCompany,
  ],
  execute: ({ visit, membership, selfUserId }) =>
    Effect.gen(function* () {
      const client = yield* SpaHttpClient;
      const { account_deleted } = yield* client.membership.remove({
        params: { companyId: membership.companyId, targetUserId: selfUserId },
      });
      return account_deleted
        ? Message.SucceededLeaveLastCompany()
        : Message.SucceededLeaveCompany({ visit, companyName: membership.companyName });
    }).pipe(
      Effect.catchTags({
        LastOwner: failedLeave(visit, membership.companyId, "LastOwner"),
        Forbidden: failedLeave(visit, membership.companyId, "Unexpected"),
        NotFound: failedLeave(visit, membership.companyId, "Unexpected"),
        Unauthorized: failedLeave(visit, membership.companyId, "Unauthorized"),
        HttpClientError: failedLeave(visit, membership.companyId, "Unexpected"),
        SchemaError: failedLeave(visit, membership.companyId, "Unexpected"),
      }),
    ),
});

export const init = (visit: number): Update.Return<Model, Message, SpaHttpClient> => ({
  model: {
    visit,
    maybeSelfUserId: Option.none(),
    leaving: Submission.Idle(),
    maybeSoleOwnerCompanyId: Option.none(),
    addCompany: AddCompany.init(),
    ownershipTransfer: OwnershipTransfer.init(),
  },
  commands: [ReadSignedInUserId({ visit })],
});

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, SpaHttpClient>;
type Step = Update.StepWithOutMessage<Model, Message, OutMessage, SpaHttpClient>;

const isLeaving = (model: Model) => Submission.guards.Submitting(model.leaving);

const forThisVisit = (model: Model, visit: number, next: () => UpdateReturn): UpdateReturn =>
  visit === model.visit ? next() : { model };

const changedCompanyState = (doneText: string, actionText: string): OutMessage =>
  OutMessage.UpdatedCompanyState({ texts: { maybeDoneText: Option.some(doneText), actionText } });

const startLeave = (model: Model, membership: CurrentCompany.Membership): UpdateReturn =>
  Option.match(model.maybeSelfUserId, {
    onNone: () => ({ model }),
    onSome: (selfUserId) =>
      isLeaving(model)
        ? { model }
        : {
            model: modifyFields(model, {
              leaving: () => Submission.Submitting(),
              maybeSoleOwnerCompanyId: () => Option.none(),
            }),
            commands: [LeaveCompany({ visit: model.visit, membership, selfUserId })],
          },
  });

const failLeave = (
  model: Model,
  companyId: string,
  failure: typeof LeaveCompanyFailure.Type,
): UpdateReturn => {
  const settled = modifyFields(model, { leaving: () => Submission.Idle() });
  return Match.value(failure).pipe(
    Match.withReturnType<UpdateReturn>(),
    Match.when("LastOwner", () => ({
      model: modifyFields(settled, { maybeSoleOwnerCompanyId: () => Option.some(companyId) }),
    })),
    Match.when("Unauthorized", () => ({ model: settled, outMessage: OutMessage.RequiredSignIn() })),
    Match.when("Unexpected", () => ({
      model: settled,
      outMessage: OutMessage.Notified({ tone: "Error", text: LEAVE_FAILED }),
    })),
    Match.exhaustive,
  );
};

const foldAddCompany = Update.foldChild({
  update: AddCompany.update,
  read: (model: Model) => Option.some(model.addCompany),
  write: (model: Model, nextAddCompany: AddCompany.Model) =>
    modifyFields(model, { addCompany: () => nextAddCompany }),
  toParentMessage: (message: AddCompany.Message) => Message.GotAddCompanyMessage({ message }),
  foldOutMessage: AddCompany.OutMessage.match<Step>({
    AddedCompany:
      ({ companyName }) =>
      (model) => ({
        model,
        outMessage: changedCompanyState(
          `「${companyName}」を作成し、現在の事業所に切り替えました。`,
          "事業所を作成しました",
        ),
      }),
    RequiredSignIn: () => (model) => ({ model, outMessage: OutMessage.RequiredSignIn() }),
  }),
});

const ownershipTransferChild = {
  read: (model: Model) => Option.some(model.ownershipTransfer),
  write: (model: Model, nextTransfer: OwnershipTransfer.Model) =>
    modifyFields(model, { ownershipTransfer: () => nextTransfer }),
  toParentMessage: (message: OwnershipTransfer.Message) =>
    Message.GotOwnershipTransferMessage({ message }),
  foldOutMessage: OwnershipTransfer.OutMessage.match<Step>({
    TransferredOwnership:
      ({ memberLabel }) =>
      (model) => ({
        model: modifyFields(model, { maybeSoleOwnerCompanyId: () => Option.none() }),
        outMessage: changedCompanyState(
          `${memberLabel} にオーナーを委譲しました。`,
          "オーナーを委譲しました",
        ),
      }),
    RequiredSignIn: () => (model) => ({ model, outMessage: OutMessage.RequiredSignIn() }),
  }),
};

const foldOwnershipTransfer = Update.foldChild({
  ...ownershipTransferChild,
  update: OwnershipTransfer.update,
});

const foldOwnershipTransferOpen = Update.foldChild({
  ...ownershipTransferChild,
  update: OwnershipTransfer.open,
});

const openOwnershipTransfer = (model: Model, membership: CurrentCompany.Membership): UpdateReturn =>
  Option.match(model.maybeSelfUserId, {
    onNone: () => ({ model }),
    onSome: (selfUserId) =>
      foldOwnershipTransferOpen(model, {
        companyId: membership.companyId,
        companyName: membership.companyName,
        selfUserId,
      }),
  });

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    CompletedReadSignedInUserId: ({ visit, maybeUserId }) =>
      forThisVisit(model, visit, () => ({
        model: modifyFields(model, { maybeSelfUserId: () => maybeUserId }),
      })),
    ClickedSwitchCompany: ({ companyId }) =>
      isLeaving(model)
        ? { model }
        : { model, outMessage: OutMessage.SelectedCompany({ companyId }) },
    ClickedLeaveCompany: ({ membership }) => startLeave(model, membership),
    SucceededLeaveCompany: ({ visit, companyName }) =>
      forThisVisit(model, visit, () => ({
        model: modifyFields(model, { leaving: () => Submission.Idle() }),
        outMessage: changedCompanyState(
          `「${companyName}」から抜けました。`,
          "事業所から抜けました",
        ),
      })),
    SucceededLeaveLastCompany: () => ({ model }),
    FailedLeaveCompany: ({ visit, companyId, failure }) =>
      forThisVisit(model, visit, () => failLeave(model, companyId, failure)),
    ClickedTransferOwnership: ({ membership }) => openOwnershipTransfer(model, membership),
    GotAddCompanyMessage: ({ message: addCompanyMessage }) =>
      foldAddCompany(model, addCompanyMessage),
    GotOwnershipTransferMessage: ({ message: transferMessage }) =>
      foldOwnershipTransfer(model, transferMessage),
  });

const switchButtonView = (
  model: Model,
  currentCompany: CurrentCompany.Model,
  membership: CurrentCompany.Membership,
  h: HtmlBuilder<Message>,
): Html =>
  buttonView(
    {
      label: "切替",
      type: "button",
      look: "outlineSmall",
      submission: CurrentCompany.Switching.matchOrElse(
        currentCompany.switching,
        {
          Switching: ({ companyId }) =>
            companyId === membership.companyId ? Submission.Submitting() : Submission.Idle(),
        },
        () => Submission.Idle(),
      ),
      isBlocked: isLeaving(model) || CurrentCompany.isBusy(currentCompany),
      onClick: Message.ClickedSwitchCompany({ companyId: membership.companyId }),
    },
    h,
  );

const leaveOrTransferButtonView = (
  model: Model,
  currentCompany: CurrentCompany.Model,
  membership: CurrentCompany.Membership,
  h: HtmlBuilder<Message>,
): Html =>
  Option.contains(model.maybeSoleOwnerCompanyId, membership.companyId)
    ? buttonView(
        {
          label: "オーナーを委譲",
          type: "button",
          look: "outlineSmall",
          submission: Submission.Idle(),
          isBlocked: false,
          onClick: Message.ClickedTransferOwnership({ membership }),
        },
        h,
      )
    : buttonView(
        {
          label: "抜ける",
          type: "button",
          look: "ghostSmall",
          submission: Submission.Idle(),
          isBlocked:
            isLeaving(model) ||
            CurrentCompany.isBusy(currentCompany) ||
            Option.isNone(model.maybeSelfUserId),
          onClick: Message.ClickedLeaveCompany({ membership }),
        },
        h,
      );

const companyRowView = (
  model: Model,
  currentCompany: CurrentCompany.Model,
  membership: CurrentCompany.Membership,
  h: HtmlBuilder<Message>,
): Html => {
  const isCurrent = Option.contains(
    currentCompany.state.maybeCurrentCompanyId,
    membership.companyId,
  );
  return h.keyed("div")(
    membership.companyId,
    [
      h.Class(
        "flex items-center justify-between rounded-md border border-border px-4 py-3 text-sm",
      ),
    ],
    [
      h.div(
        [],
        [
          h.p(
            [h.Class("flex items-center gap-2 font-medium text-foreground")],
            [
              membership.companyName,
              ...(isCurrent
                ? [
                    h.span(
                      [
                        h.Class(
                          "inline-flex items-center gap-1 text-xs text-primary [&_svg]:size-3",
                        ),
                      ],
                      [iconView(Check, h), "選択中"],
                    ),
                  ]
                : []),
            ],
          ),
          h.p(
            [h.Class("text-xs text-muted-foreground")],
            [`${roleLabelJa(membership.role)} ・ ${orgCodeLabelJa(membership.orgCode)}`],
          ),
        ],
      ),
      h.div(
        [h.Class("flex items-center gap-2")],
        [
          ...(isCurrent ? [] : [switchButtonView(model, currentCompany, membership, h)]),
          leaveOrTransferButtonView(model, currentCompany, membership, h),
        ],
      ),
    ],
  );
};

export const view = Submodel.defineView<Model, Message, ViewInputs>(
  (model, { currentCompany }, h) =>
    h.div(
      [],
      [
        h.div(
          [h.Class("flex items-start justify-between gap-4")],
          [
            pageTitleView("所属事業所", "所属する事業所の一覧と切り替え", h),
            h.submodel({
              slotId: "add-company",
              view: AddCompany.view,
              model: model.addCompany,
              toParentMessage: (message) => Message.GotAddCompanyMessage({ message }),
            }),
          ],
        ),
        separatorView("my-6", h),
        h.div(
          [h.Class("space-y-2")],
          currentCompany.state.memberships.map((membership) =>
            companyRowView(model, currentCompany, membership, h),
          ),
        ),
        ...(Option.isSome(model.maybeSoleOwnerCompanyId)
          ? [
              h.p(
                [h.Role("alert"), h.Class("mt-4 text-sm text-destructive")],
                [SOLE_OWNER_CANNOT_LEAVE],
              ),
            ]
          : []),
        h.submodel({
          slotId: "ownership-transfer",
          view: OwnershipTransfer.view,
          model: model.ownershipTransfer,
          toParentMessage: (message) => Message.GotOwnershipTransferMessage({ message }),
        }),
      ],
    ),
);
