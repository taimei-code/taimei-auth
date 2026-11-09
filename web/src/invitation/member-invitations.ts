import { Array, DateTime, Effect, Number, Option, Schema, String } from "effect";
import { Command, Submodel, Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { defineTaggedUnion } from "foldkit/schema";
import { modifyFields } from "foldkit/struct";

import { RoleSchema } from "@core/membership/membership-contract";
import type { Role } from "@core/membership/policy";
import { roleLabelJa } from "@core/membership/role-label";

import { separatorView } from "../account/account-page-header-view";
import type { FailureMessages } from "../shared/failure-message";
import { type DeclaredFailure, SpaHttpClient } from "../shared/spa-http-client";
import { Submission } from "../shared/submission";
import { alertTextView } from "../shared/ui/alert-text-view";
import { buttonView } from "../shared/ui/button-view";
import { spinnerView } from "../shared/ui/icon-view";
import { inputView } from "../shared/ui/input-view";
import { fieldSelectView } from "../shared/ui/select-view";
import { NoticeTone, ReloadTexts, staleNoticeOf } from "../shared/ui/toast-view";
import { parseRedirectTarget } from "./redirect-target";

const PendingInvitation = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  role: RoleSchema,
  expiresAtText: Schema.String,
});
type PendingInvitation = typeof PendingInvitation.Type;

const Pending = defineTaggedUnion({
  Loading: {},
  Failed: {},
  Loaded: { invitations: Schema.Array(PendingInvitation) },
});

const RevokeProgress = defineTaggedUnion({
  Idle: {},
  Revoking: { invitationId: Schema.String },
});

export const RedirectSearch = Schema.Struct({
  service_name: Schema.optional(Schema.String),
  redirect_url: Schema.optional(Schema.String),
});
export type RedirectSearch = typeof RedirectSearch.Type;

const Reload = defineTaggedUnion({
  Opened: {},
  Sent: { texts: ReloadTexts },
  Revoked: { texts: ReloadTexts },
});
type Reload = typeof Reload.Type;

export const Model = Schema.Struct({
  visit: Schema.Int,
  companyId: Schema.String,
  assignableRoles: Schema.Array(RoleSchema),
  redirectSearch: RedirectSearch,
  emailDraft: Schema.String,
  roleDraft: RoleSchema,
  sending: Submission,
  pending: Pending,
  listNumber: Schema.Int,
  revoking: RevokeProgress,
});
export type Model = typeof Model.Type;

const RequestFailure = Schema.Literals(["Unauthorized", "Unexpected"]);
const CreateInvitationFailure = Schema.Literals([
  "Forbidden",
  "RateLimited",
  "Unauthorized",
  "Unexpected",
]);
type CreateInvitationFailure = typeof CreateInvitationFailure.Type;
const RevokeInvitationFailure = Schema.Literals([
  "Forbidden",
  "NotFoundOrNotPending",
  "Unauthorized",
  "Unexpected",
]);
type RevokeInvitationFailure = typeof RevokeInvitationFailure.Type;

export const Message = defineMessageUnion({
  UpdatedEmail: { value: Schema.String },
  SelectedRole: { value: Schema.String },
  SubmittedInvitation: {},
  SucceededCreateInvitation: { visit: Schema.Int, reused: Schema.Boolean },
  FailedCreateInvitation: { visit: Schema.Int, failure: CreateInvitationFailure },
  ClickedRevoke: { invitationId: Schema.String },
  SucceededRevokeInvitation: { visit: Schema.Int },
  FailedRevokeInvitation: { visit: Schema.Int, failure: RevokeInvitationFailure },
  SucceededLoadInvitations: {
    visit: Schema.Int,
    listNumber: Schema.Int,
    invitations: Schema.Array(PendingInvitation),
    reload: Reload,
  },
  FailedLoadInvitations: {
    visit: Schema.Int,
    listNumber: Schema.Int,
    failure: RequestFailure,
    reload: Reload,
  },
});
export type Message = typeof Message.Type;

export const OutMessage = defineMessageUnion({
  Notified: { tone: NoticeTone, text: Schema.String },
  RequiredSignIn: {},
});
export type OutMessage = typeof OutMessage.Type;

const INVITE_FAILED = "招待の送信に失敗しました。";
const REVOKE_FAILED = "招待の取り消しに失敗しました。";

const CREATE_FAILURE_MESSAGES = {
  ...({
    RateLimited: "招待の送信回数が上限に達しました。時間をおいて再試行してください。",
    Forbidden: "招待する権限がありません。",
  } satisfies FailureMessages<DeclaredFailure<"invitation", "create">>),
  Unexpected: INVITE_FAILED,
};

const REVOKE_FAILURE_MESSAGES = {
  ...({
    Forbidden: "招待を取り消す権限がありません。",
    NotFoundOrNotPending: REVOKE_FAILED,
  } satisfies FailureMessages<DeclaredFailure<"invitation", "revoke">>),
  Unexpected: REVOKE_FAILED,
};

const textsAfterSending = (reused: boolean): ReloadTexts =>
  reused
    ? { doneText: "既存の招待を再送しました。", actionText: "既存の招待を再送しました" }
    : { doneText: "招待を送信しました。", actionText: "招待を送信しました" };

const AFTER_REVOKE: ReloadTexts = {
  doneText: "招待を取り消しました。",
  actionText: "招待を取り消しました",
};

const expiresAtFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

export const expiresAtTextOf = (expiresAt: string): Option.Option<string> =>
  Option.map(DateTime.make(expiresAt), (dateTime) =>
    expiresAtFormatter.format(DateTime.toDateUtc(dateTime)),
  );

export const LoadInvitations = Command.define("LoadInvitations", {
  args: { visit: Schema.Int, listNumber: Schema.Int, companyId: Schema.String, reload: Reload },
  messages: [Message.SucceededLoadInvitations, Message.FailedLoadInvitations],
  execute: ({ visit, listNumber, companyId, reload }) => {
    const failedLoad = (failure: typeof RequestFailure.Type) => () =>
      Effect.succeed(Message.FailedLoadInvitations({ visit, listNumber, failure, reload }));
    return Effect.gen(function* () {
      const client = yield* SpaHttpClient;
      const { invitations } = yield* client.invitation.pending({ params: { companyId } });
      const maybeRows = Option.all(
        invitations.map((invitation) =>
          Option.map(expiresAtTextOf(invitation.expires_at), (expiresAtText) => ({
            id: invitation.id,
            email: invitation.email,
            role: invitation.role,
            expiresAtText,
          })),
        ),
      );
      return Option.match(maybeRows, {
        onNone: () =>
          Message.FailedLoadInvitations({ visit, listNumber, failure: "Unexpected", reload }),
        onSome: (rows) =>
          Message.SucceededLoadInvitations({ visit, listNumber, reload, invitations: rows }),
      });
    }).pipe(
      Effect.catchTags({
        Forbidden: failedLoad("Unexpected"),
        Unauthorized: failedLoad("Unauthorized"),
        HttpClientError: failedLoad("Unexpected"),
        SchemaError: failedLoad("Unexpected"),
      }),
    );
  },
});

const failedCreate = (visit: number, failure: CreateInvitationFailure) => () =>
  Effect.succeed(Message.FailedCreateInvitation({ visit, failure }));

export const CreateInvitation = Command.define("CreateInvitation", {
  args: {
    visit: Schema.Int,
    companyId: Schema.String,
    email: Schema.String,
    role: RoleSchema,
    redirectSearch: RedirectSearch,
  },
  messages: [Message.SucceededCreateInvitation, Message.FailedCreateInvitation],
  execute: ({ visit, companyId, email, role, redirectSearch }) =>
    Effect.gen(function* () {
      const client = yield* SpaHttpClient;
      const redirectTarget = parseRedirectTarget(redirectSearch);
      const { reused } = yield* client.invitation.create({
        params: { companyId },
        payload: {
          email,
          role,
          ...(redirectTarget === undefined ? {} : { redirect_target: redirectTarget }),
        },
      });
      return Message.SucceededCreateInvitation({ visit, reused });
    }).pipe(
      Effect.catchTags({
        Forbidden: failedCreate(visit, "Forbidden"),
        RateLimited: failedCreate(visit, "RateLimited"),
        Unauthorized: failedCreate(visit, "Unauthorized"),
        HttpClientError: failedCreate(visit, "Unexpected"),
        SchemaError: failedCreate(visit, "Unexpected"),
      }),
    ),
});

const failedRevoke = (visit: number, failure: RevokeInvitationFailure) => () =>
  Effect.succeed(Message.FailedRevokeInvitation({ visit, failure }));

export const RevokeInvitation = Command.define("RevokeInvitation", {
  args: { visit: Schema.Int, companyId: Schema.String, invitationId: Schema.String },
  messages: [Message.SucceededRevokeInvitation, Message.FailedRevokeInvitation],
  execute: ({ visit, companyId, invitationId }) =>
    Effect.gen(function* () {
      const client = yield* SpaHttpClient;
      yield* client.invitation.revoke({ params: { companyId, invitationId } });
      return Message.SucceededRevokeInvitation({ visit });
    }).pipe(
      Effect.catchTags({
        Forbidden: failedRevoke(visit, "Forbidden"),
        NotFoundOrNotPending: failedRevoke(visit, "NotFoundOrNotPending"),
        Unauthorized: failedRevoke(visit, "Unauthorized"),
        HttpClientError: failedRevoke(visit, "Unexpected"),
        SchemaError: failedRevoke(visit, "Unexpected"),
      }),
    ),
});

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, SpaHttpClient>;

export const init = (
  start: Readonly<{
    visit: number;
    companyId: string;
    assignableRoles: ReadonlyArray<Role>;
    redirectSearch: RedirectSearch;
  }>,
): Update.Return<Model, Message, SpaHttpClient> => ({
  model: {
    ...start,
    emailDraft: "",
    roleDraft: "MEMBER",
    sending: Submission.Idle(),
    pending: Pending.Loading(),
    listNumber: 0,
    revoking: RevokeProgress.Idle(),
  },
  commands: [
    LoadInvitations({
      visit: start.visit,
      listNumber: 0,
      companyId: start.companyId,
      reload: Reload.Opened(),
    }),
  ],
});

const isSending = (model: Model) => Submission.guards.Submitting(model.sending);

const isRevoking = (model: Model) => RevokeProgress.guards.Revoking(model.revoking);

const forThisVisit = (model: Model, visit: number, next: () => UpdateReturn): UpdateReturn =>
  visit === model.visit ? next() : { model };

const reloadAfter = (model: Model, reload: Reload): UpdateReturn => {
  const requested = modifyFields(model, { listNumber: Number.increment });
  return {
    model: requested,
    commands: [
      LoadInvitations({
        visit: model.visit,
        listNumber: requested.listNumber,
        companyId: model.companyId,
        reload,
      }),
    ],
  };
};

const finishReload = (model: Model, reload: Reload, textOf: (texts: ReloadTexts) => OutMessage) =>
  Reload.match<UpdateReturn>(reload, {
    Opened: () => ({ model }),
    Sent: ({ texts }) => ({
      model: modifyFields(model, { sending: () => Submission.Idle() }),
      outMessage: textOf(texts),
    }),
    Revoked: ({ texts }) => ({
      model: modifyFields(model, { revoking: () => RevokeProgress.Idle() }),
      outMessage: textOf(texts),
    }),
  });

const hasEmail = (model: Model) => String.isNonEmpty(String.trim(model.emailDraft));

const isLatestList = (model: Model, listNumber: number) => listNumber === model.listNumber;

const submitInvitation = (model: Model): UpdateReturn => {
  const email = String.trim(model.emailDraft);
  return isSending(model) || !hasEmail(model)
    ? { model }
    : {
        model: modifyFields(model, { sending: () => Submission.Submitting() }),
        commands: [
          CreateInvitation({
            visit: model.visit,
            companyId: model.companyId,
            email,
            role: model.roleDraft,
            redirectSearch: model.redirectSearch,
          }),
        ],
      };
};

const startRevoke = (model: Model, invitationId: string): UpdateReturn =>
  isRevoking(model)
    ? { model }
    : {
        model: modifyFields(model, { revoking: () => RevokeProgress.Revoking({ invitationId }) }),
        commands: [
          RevokeInvitation({ visit: model.visit, companyId: model.companyId, invitationId }),
        ],
      };

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    UpdatedEmail: ({ value }) =>
      isSending(model) ? { model } : { model: modifyFields(model, { emailDraft: () => value }) },
    SelectedRole: ({ value }) =>
      Option.match(
        Array.findFirst(model.assignableRoles, (role) => role === value),
        {
          onNone: () => ({ model }),
          onSome: (role) => ({ model: modifyFields(model, { roleDraft: () => role }) }),
        },
      ),
    SubmittedInvitation: () => submitInvitation(model),
    SucceededCreateInvitation: ({ visit, reused }) =>
      forThisVisit(model, visit, () =>
        reloadAfter(
          modifyFields(model, { emailDraft: () => "" }),
          Reload.Sent({ texts: textsAfterSending(reused) }),
        ),
      ),
    FailedCreateInvitation: ({ visit, failure }) =>
      forThisVisit(model, visit, () =>
        failure === "Unauthorized"
          ? { model, outMessage: OutMessage.RequiredSignIn() }
          : {
              model: modifyFields(model, { sending: () => Submission.Idle() }),
              outMessage: OutMessage.Notified({
                tone: "Error",
                text: CREATE_FAILURE_MESSAGES[failure],
              }),
            },
      ),
    ClickedRevoke: ({ invitationId }) => startRevoke(model, invitationId),
    SucceededRevokeInvitation: ({ visit }) =>
      forThisVisit(model, visit, () => reloadAfter(model, Reload.Revoked({ texts: AFTER_REVOKE }))),
    FailedRevokeInvitation: ({ visit, failure }) =>
      forThisVisit(model, visit, () =>
        failure === "Unauthorized"
          ? { model, outMessage: OutMessage.RequiredSignIn() }
          : {
              model: modifyFields(model, { revoking: () => RevokeProgress.Idle() }),
              outMessage: OutMessage.Notified({
                tone: "Error",
                text: REVOKE_FAILURE_MESSAGES[failure],
              }),
            },
      ),
    SucceededLoadInvitations: ({ visit, listNumber, invitations, reload }) =>
      forThisVisit(model, visit, () =>
        finishReload(
          isLatestList(model, listNumber)
            ? modifyFields(model, { pending: () => Pending.Loaded({ invitations }) })
            : model,
          reload,
          ({ doneText }) => OutMessage.Notified({ tone: "Success", text: doneText }),
        ),
      ),
    FailedLoadInvitations: ({ visit, listNumber, failure, reload }) =>
      forThisVisit(model, visit, () =>
        failure === "Unauthorized"
          ? { model, outMessage: OutMessage.RequiredSignIn() }
          : finishReload(
              isLatestList(model, listNumber) && !Pending.guards.Loaded(model.pending)
                ? modifyFields(model, { pending: () => Pending.Failed() })
                : model,
              reload,
              ({ actionText }) =>
                OutMessage.Notified({ tone: "Error", text: staleNoticeOf(actionText) }),
            ),
      ),
  });

const ROLE_SELECT_ID = "invite-role";

const inviteFormView = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.section(
    [h.AriaLabel("メンバーを招待"), h.Class("space-y-4")],
    [
      h.h2([h.Class("text-sm font-medium text-foreground")], ["メンバーを招待"]),
      h.form(
        [
          h.Class("flex flex-col gap-3 sm:flex-row sm:items-end"),
          h.OnSubmit(Message.SubmittedInvitation()),
        ],
        [
          h.div(
            [h.Class("flex-1")],
            [
              inputView(
                {
                  id: "invite-email",
                  label: "メールアドレス",
                  type: "email",
                  value: model.emailDraft,
                  onInput: (value) => Message.UpdatedEmail({ value }),
                  submission: model.sending,
                  placeholder: "member@example.com",
                },
                h,
              ),
            ],
          ),
          fieldSelectView(
            {
              id: ROLE_SELECT_ID,
              label: { _tag: "Visible", text: "役割" },
              value: model.roleDraft,
              options: model.assignableRoles.map((role) => ({
                value: role,
                label: roleLabelJa(role),
              })),
              isDisabled: isSending(model),
              onChange: (value) => Message.SelectedRole({ value }),
              placement: "InForm",
            },
            h,
          ),
          buttonView(
            {
              label: "招待する",
              type: "submit",
              look: "primaryInline",
              submission: model.sending,
              isBlocked: !hasEmail(model),
            },
            h,
          ),
        ],
      ),
    ],
  );

const pendingRowView = (
  model: Model,
  invitation: PendingInvitation,
  h: HtmlBuilder<Message>,
): Html =>
  h.keyed("div")(
    invitation.id,
    [
      h.Class(
        "flex items-center justify-between gap-3 rounded-md border border-dashed border-border px-4 py-3 text-sm",
      ),
    ],
    [
      h.div(
        [h.Class("min-w-0")],
        [
          h.p(
            [h.Title(invitation.email), h.Class("truncate font-medium text-foreground")],
            [invitation.email],
          ),
          h.p(
            [h.Class("text-xs text-muted-foreground")],
            [`${roleLabelJa(invitation.role)} / 期限 ${invitation.expiresAtText}`],
          ),
        ],
      ),
      h.div(
        [h.Class("flex shrink-0 items-center gap-2")],
        [
          ...(RevokeProgress.matchOrElse(
            model.revoking,
            { Revoking: ({ invitationId }) => invitationId === invitation.id },
            () => false,
          )
            ? [h.span([h.Class("size-4 text-muted-foreground")], [spinnerView(h)])]
            : []),
          buttonView(
            {
              label: "取消",
              type: "button",
              look: "outlineSmall",
              submission: Submission.Idle(),
              isBlocked: isRevoking(model),
              onClick: Message.ClickedRevoke({ invitationId: invitation.id }),
            },
            h,
          ),
        ],
      ),
    ],
  );

const pendingView = (model: Model, h: HtmlBuilder<Message>): ReadonlyArray<Html> =>
  Pending.match(model.pending, {
    Loading: () => [],
    Failed: () => [
      separatorView("my-8", h),
      alertTextView("招待中の一覧を取得できませんでした。", h),
    ],
    Loaded: ({ invitations }) =>
      Array.match(invitations, {
        onEmpty: () => [],
        onNonEmpty: (rows) => [
          separatorView("my-8", h),
          h.section(
            [h.AriaLabel("招待中"), h.Class("space-y-2")],
            [
              h.h2([h.Class("text-sm font-medium text-foreground")], ["招待中"]),
              ...rows.map((invitation) => pendingRowView(model, invitation, h)),
            ],
          ),
        ],
      }),
  });

export const view = Submodel.defineView<Model, Message>((model, h) =>
  h.div([], [inviteFormView(model, h), ...pendingView(model, h)]),
);
