import { Array, Effect, Number, Option, Schema, pipe } from "effect";
import { Command, Submodel, Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { defineTaggedUnion } from "foldkit/schema";
import { modifyFields } from "foldkit/struct";

import { SpaHttpClient } from "../shared/spa-http-client";
import { Submission } from "../shared/submission";
import { buttonView } from "../shared/ui/button-view";
import {
  Dialog,
  type DialogMessage,
  ReportingDialog,
  reportingDialogFoldsOf,
  dialogView,
} from "../shared/ui/dialog-view";
import { loadingStatusView } from "../shared/ui/icon-view";
import { memberLabel } from "./member-label";

const Candidate = Schema.Struct({ userId: Schema.String, label: Schema.String });
type Candidate = typeof Candidate.Type;

const Target = Schema.Struct({
  companyId: Schema.String,
  companyName: Schema.String,
  selfUserId: Schema.String,
});
export type Target = typeof Target.Type;

const Candidates = defineTaggedUnion({
  Loading: {},
  Failed: {},
  Loaded: { candidates: Schema.Array(Candidate) },
});
type Candidates = typeof Candidates.Type;

const Transferring = defineTaggedUnion({
  Idle: {},
  Transferring: { userId: Schema.String },
  Failed: {},
});

export const OutMessage = defineMessageUnion({
  TransferredOwnership: { memberLabel: Schema.String },
  RequiredSignIn: {},
});
export type OutMessage = typeof OutMessage.Type;

export const Model = Schema.Struct({
  visit: Schema.Int,
  dialog: ReportingDialog.Model(OutMessage),
  maybeTarget: Schema.Option(Target),
  candidates: Candidates,
  transferring: Transferring,
  requestNumber: Schema.Int,
});
export type Model = typeof Model.Type;

const RequestFailure = Schema.Literals(["Unauthorized", "Unexpected"]);

const RequestFields = { visit: Schema.Int, requestNumber: Schema.Int };
type Request = Readonly<{ visit: number; requestNumber: number }>;

export const Message = defineMessageUnion({
  GotDialogMessage: { message: Dialog.Message },
  SucceededLoadCandidates: { ...RequestFields, candidates: Schema.Array(Candidate) },
  FailedLoadCandidates: { ...RequestFields, failure: RequestFailure },
  ClickedTransfer: { candidate: Candidate },
  SucceededTransferOwnership: { ...RequestFields, memberLabel: Schema.String },
  FailedTransferOwnership: { ...RequestFields, failure: RequestFailure },
});
export type Message = typeof Message.Type;

const isTransferredOwnership = Schema.is(Message.SucceededTransferOwnership);

export const visitOfCompanyChange = (message: Message): Option.Option<number> =>
  isTransferredOwnership(message) ? Option.some(message.visit) : Option.none();

const TRANSFER_FAILED = "オーナー委譲に失敗しました。";

const failedLoadCandidates = (request: Request, failure: typeof RequestFailure.Type) => () =>
  Effect.succeed(Message.FailedLoadCandidates({ ...request, failure }));

export const LoadCandidates = Command.define("LoadCandidates", {
  args: { ...RequestFields, target: Target },
  messages: [Message.SucceededLoadCandidates, Message.FailedLoadCandidates],
  execute: ({ target, ...request }) =>
    Effect.gen(function* () {
      const client = yield* SpaHttpClient;
      const { members } = yield* client.membership.list({
        params: { companyId: target.companyId },
      });
      return Message.SucceededLoadCandidates({
        ...request,
        candidates: members
          .filter((member) => member.user_id !== target.selfUserId)
          .map((member) => ({ userId: member.user_id, label: memberLabel(member) })),
      });
    }).pipe(
      Effect.catchTags({
        Forbidden: failedLoadCandidates(request, "Unexpected"),
        Unauthorized: failedLoadCandidates(request, "Unauthorized"),
        HttpClientError: failedLoadCandidates(request, "Unexpected"),
        SchemaError: failedLoadCandidates(request, "Unexpected"),
      }),
    ),
});

const failedTransfer = (request: Request, failure: typeof RequestFailure.Type) => () =>
  Effect.succeed(Message.FailedTransferOwnership({ ...request, failure }));

export const TransferOwnership = Command.define("TransferOwnership", {
  args: { ...RequestFields, companyId: Schema.String, candidate: Candidate },
  messages: [Message.SucceededTransferOwnership, Message.FailedTransferOwnership],
  execute: ({ companyId, candidate, ...request }) =>
    Effect.gen(function* () {
      const client = yield* SpaHttpClient;
      yield* client.membership.transferOwnership({
        params: { companyId },
        payload: { to_user_id: candidate.userId },
      });
      return Message.SucceededTransferOwnership({ ...request, memberLabel: candidate.label });
    }).pipe(
      Effect.catchTags({
        Forbidden: failedTransfer(request, "Unexpected"),
        NotFound: failedTransfer(request, "Unexpected"),
        InvalidArgument: failedTransfer(request, "Unexpected"),
        AlreadyOwner: failedTransfer(request, "Unexpected"),
        LastOwner: failedTransfer(request, "Unexpected"),
        Unauthorized: failedTransfer(request, "Unauthorized"),
        HttpClientError: failedTransfer(request, "Unexpected"),
        SchemaError: failedTransfer(request, "Unexpected"),
      }),
    ),
});

const DIALOG_ID = "ownership-transfer-dialog";

export const init = (visit: number): Model => ({
  visit,
  dialog: ReportingDialog.init({ id: DIALOG_ID }),
  maybeTarget: Option.none(),
  candidates: Candidates.Loading(),
  transferring: Transferring.Idle(),
  requestNumber: 0,
});

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, SpaHttpClient>;

const isTransferring = (model: Model) => Transferring.guards.Transferring(model.transferring);

const toDialogMessage = (message: DialogMessage) => Message.GotDialogMessage({ message });

const dialogFolds = reportingDialogFoldsOf<OutMessage>()({
  isClosingBlocked: isTransferring,
  toParentMessage: toDialogMessage,
  whenClosed: (model) => modifyFields(model, { transferring: () => Transferring.Idle() }),
});

export const open = (model: Model, target: Target): UpdateReturn => {
  const requested = modifyFields(model, {
    maybeTarget: () => Option.some(target),
    candidates: () => Candidates.Loading(),
    transferring: () => Transferring.Idle(),
    requestNumber: Number.increment,
  });
  const opened = dialogFolds.open(requested);
  const loading: Update.Return<Model, Message, SpaHttpClient> = {
    model: opened.model,
    commands: [
      ...(opened.commands ?? []),
      LoadCandidates({ visit: requested.visit, requestNumber: requested.requestNumber, target }),
    ],
  };
  return pipe(loading, Update.withOutMessage(opened.outMessage));
};

const forThisRequest = (model: Model, request: Request, next: () => UpdateReturn) =>
  request.visit === model.visit && request.requestNumber === model.requestNumber
    ? next()
    : { model };

const startTransfer = (model: Model, candidate: Candidate): UpdateReturn =>
  Option.match(model.maybeTarget, {
    onNone: () => ({ model }),
    onSome: ({ companyId }) => {
      if (isTransferring(model)) {
        return { model };
      }
      const requested = modifyFields(model, {
        transferring: () => Transferring.Transferring({ userId: candidate.userId }),
        requestNumber: Number.increment,
      });
      return {
        model: requested,
        commands: [
          TransferOwnership({
            visit: requested.visit,
            requestNumber: requested.requestNumber,
            companyId,
            candidate,
          }),
        ],
      };
    },
  });

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    GotDialogMessage: ({ message: dialogMessage }) => dialogFolds.fold(model, dialogMessage),
    SucceededLoadCandidates: (loaded) =>
      forThisRequest(model, loaded, () => ({
        model: modifyFields(model, {
          candidates: () => Candidates.Loaded({ candidates: loaded.candidates }),
        }),
      })),
    FailedLoadCandidates: (failed) =>
      forThisRequest(model, failed, () =>
        failed.failure === "Unauthorized"
          ? { model, outMessage: OutMessage.RequiredSignIn() }
          : { model: modifyFields(model, { candidates: () => Candidates.Failed() }) },
      ),
    ClickedTransfer: ({ candidate }) => startTransfer(model, candidate),
    SucceededTransferOwnership: (transferred) =>
      forThisRequest(model, transferred, () =>
        dialogFolds.closeThen(
          model,
          OutMessage.TransferredOwnership({ memberLabel: transferred.memberLabel }),
        ),
      ),
    FailedTransferOwnership: (failed) =>
      forThisRequest(model, failed, () =>
        failed.failure === "Unauthorized"
          ? { model, outMessage: OutMessage.RequiredSignIn() }
          : {
              model: modifyFields(model, {
                transferring: () => Transferring.Failed(),
              }),
            },
      ),
  });

const candidateRowView = (model: Model, candidate: Candidate, h: HtmlBuilder<Message>): Html =>
  h.keyed("div")(
    candidate.userId,
    [
      h.Class(
        "flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm",
      ),
    ],
    [
      h.span([], [candidate.label]),
      buttonView(
        {
          label: "委譲",
          type: "button",
          look: "primarySmall",
          submission: Transferring.matchOrElse(
            model.transferring,
            {
              Transferring: ({ userId }) =>
                userId === candidate.userId ? Submission.Submitting() : Submission.Idle(),
            },
            () => Submission.Idle(),
          ),
          isBlocked: isTransferring(model),
          onClick: Message.ClickedTransfer({ candidate }),
        },
        h,
      ),
    ],
  );

const candidatesView = (model: Model, candidates: Candidates, h: HtmlBuilder<Message>): Html =>
  Candidates.match(candidates, {
    Loading: () => loadingStatusView("読み込み中…", h),
    Failed: () => h.p([h.Class("text-sm text-destructive")], ["メンバーの取得に失敗しました。"]),
    Loaded: ({ candidates: loaded }) =>
      Array.match(loaded, {
        onEmpty: () =>
          h.p(
            [h.Class("py-4 text-sm text-muted-foreground")],
            ["委譲できるメンバーがいません。先にメンバーを招待してください。"],
          ),
        onNonEmpty: (rows) =>
          h.div(
            [h.Class("space-y-2")],
            rows.map((candidate) => candidateRowView(model, candidate, h)),
          ),
      }),
  });

export const view = Submodel.defineView<Model, Message>((model, h) =>
  dialogView(
    model.dialog,
    toDialogMessage,
    {
      title: "オーナーを委譲",
      description: Option.match(model.maybeTarget, {
        onNone: () => "",
        onSome: ({ companyName }) =>
          `「${companyName}」のオーナーを別のメンバーに委譲します。あなたは管理者になります。`,
      }),
      body: [
        candidatesView(model, model.candidates, h),
        ...(Transferring.guards.Failed(model.transferring)
          ? [h.p([h.Class("text-sm text-destructive")], [TRANSFER_FAILED])]
          : []),
      ],
      isClosingBlocked: isTransferring(model),
    },
    h,
  ),
);
