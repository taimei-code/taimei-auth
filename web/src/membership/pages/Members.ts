import { Array, Effect, Option, Schema, pipe } from "effect";
import { Command, Submodel, Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { defineTaggedUnion } from "foldkit/schema";
import { modifyFields } from "foldkit/struct";

import { RoleSchema } from "@core/membership/membership-contract";
import { canInviteRole, isAtLeast, type Role } from "@core/membership/policy";
import { roleLabelJa } from "@core/membership/role-label";

import {
  accountPageHeaderView,
  listEmptyView,
  separatorView,
} from "../../account/account-page-header-view";
import * as CurrentCompany from "../../account/current-company";
import { readSignedInUserId } from "../../auth/sign-in-client";
import * as MemberInvitations from "../../invitation/member-invitations";
import type { FailureMessages } from "../../shared/failure-message";
import { type DeclaredFailure, SpaHttpClient } from "../../shared/spa-http-client";
import { Submission } from "../../shared/submission";
import { alertTextView } from "../../shared/ui/alert-text-view";
import { buttonView } from "../../shared/ui/button-view";
import {
  Dialog,
  type DialogMessage,
  ReportingDialog,
  reportingDialogFoldsOf,
  dialogFooterView,
  dialogView,
} from "../../shared/ui/dialog-view";
import { listLoadingStatusView, spinnerView } from "../../shared/ui/icon-view";
import { fieldSelectView } from "../../shared/ui/select-view";
import { NoticeTone, ReloadTexts, staleNoticeOf } from "../../shared/ui/toast-view";
import { memberLabel } from "../member-label";

const Member = Schema.Struct({
  userId: Schema.String,
  label: Schema.String,
  email: Schema.String,
  role: RoleSchema,
});
type Member = typeof Member.Type;

const Members = defineTaggedUnion({
  Loading: {},
  Failed: {},
  Loaded: { members: Schema.Array(Member) },
});

const Busy = defineTaggedUnion({
  Idle: {},
  ChangingRole: { userId: Schema.String },
  Removing: { userId: Schema.String },
});
type Busy = typeof Busy.Type;

const Reload = defineTaggedUnion({
  Opened: {},
  ChangedRole: { texts: ReloadTexts },
  Removed: { texts: ReloadTexts },
});
type Reload = typeof Reload.Type;

export const OutMessage = defineMessageUnion({
  Notified: { tone: NoticeTone, text: Schema.String },
  RequiredSignIn: {},
});
export type OutMessage = typeof OutMessage.Type;

const Listing = Schema.Struct({
  companyId: Schema.String,
  actorRole: RoleSchema,
  maybeSelfUserId: Schema.Option(Schema.String),
  members: Members,
  busy: Busy,
  maybeRemovalTarget: Schema.Option(Member),
  dialog: ReportingDialog.Model(OutMessage),
  maybeInvitations: Schema.Option(MemberInvitations.Model),
});
type Listing = typeof Listing.Type;

const Page = defineTaggedUnion({
  NoCompany: {},
  Listing: Listing.fields,
});

export const Model = Schema.Struct({
  visit: Schema.Int,
  page: Page,
});
export type Model = typeof Model.Type;

const RequestFailure = Schema.Literals(["Unauthorized", "Unexpected"]);
const MemberChangeFailure = Schema.Literals([
  "Forbidden",
  "NotFound",
  "LastOwner",
  "Unauthorized",
  "Unexpected",
]);
type MemberChangeFailure = typeof MemberChangeFailure.Type;

export const Message = defineMessageUnion({
  CompletedReadSelfUserId: { visit: Schema.Int, maybeUserId: Schema.Option(Schema.String) },
  SucceededLoadMembers: { visit: Schema.Int, members: Schema.Array(Member), reload: Reload },
  FailedLoadMembers: { visit: Schema.Int, failure: RequestFailure, reload: Reload },
  SelectedRole: { member: Member, value: Schema.String },
  SucceededChangeRole: { visit: Schema.Int, texts: ReloadTexts },
  FailedChangeRole: { visit: Schema.Int, failure: MemberChangeFailure },
  ClickedRemove: { member: Member },
  ClickedCancelRemoval: {},
  ClickedConfirmRemoval: {},
  SucceededRemoveMember: { visit: Schema.Int, texts: ReloadTexts },
  FailedRemoveMember: { visit: Schema.Int, failure: MemberChangeFailure },
  GotDialogMessage: { message: Dialog.Message },
  GotMemberInvitationsMessage: { message: MemberInvitations.Message },
});
export type Message = typeof Message.Type;

const ROLES_IN_SELECT_ORDER: ReadonlyArray<Role> = ["MEMBER", "ADMIN", "OWNER"];

const ROLE_CHANGE_FAILED = "役割の変更に失敗しました。";
const REMOVAL_FAILED = "メンバーの削除に失敗しました。";

const ROLE_CHANGE_FAILURE_MESSAGES = {
  ...({
    LastOwner: "最後のオーナーを降格することはできません。",
    Forbidden: "この役割変更を行う権限がありません。",
    NotFound: ROLE_CHANGE_FAILED,
  } satisfies FailureMessages<DeclaredFailure<"membership", "changeRole">>),
  Unexpected: ROLE_CHANGE_FAILED,
};

const REMOVAL_FAILURE_MESSAGES = {
  ...({
    LastOwner: "最後のオーナーは削除できません。",
    Forbidden: REMOVAL_FAILED,
    NotFound: REMOVAL_FAILED,
  } satisfies FailureMessages<DeclaredFailure<"membership", "remove">>),
  Unexpected: REMOVAL_FAILED,
};

const textsAfterRemoval = (accountDeleted: boolean): ReloadTexts =>
  accountDeleted
    ? {
        doneText: "メンバーを削除しました。他に所属が無いためアカウントも削除されました。",
        actionText: "メンバーとアカウントを削除しました",
      }
    : { doneText: "メンバーを削除しました。", actionText: "メンバーを削除しました" };

export const ReadSelfUserId = Command.define("ReadSelfUserId", {
  args: { visit: Schema.Int },
  messages: [Message.CompletedReadSelfUserId],
  execute: ({ visit }) =>
    readSignedInUserId.pipe(
      Effect.map((maybeUserId) => Message.CompletedReadSelfUserId({ visit, maybeUserId })),
      Effect.catchTag("UnknownError", () =>
        Effect.succeed(Message.CompletedReadSelfUserId({ visit, maybeUserId: Option.none() })),
      ),
    ),
});

export const LoadMembers = Command.define("LoadMembers", {
  args: { visit: Schema.Int, companyId: Schema.String, reload: Reload },
  messages: [Message.SucceededLoadMembers, Message.FailedLoadMembers],
  execute: ({ visit, companyId, reload }) => {
    const failedLoad = (failure: typeof RequestFailure.Type) => () =>
      Effect.succeed(Message.FailedLoadMembers({ visit, failure, reload }));
    return Effect.gen(function* () {
      const client = yield* SpaHttpClient;
      const { members } = yield* client.membership.list({ params: { companyId } });
      return Message.SucceededLoadMembers({
        visit,
        reload,
        members: members.map((member) => ({
          userId: member.user_id,
          label: memberLabel(member),
          email: member.user_email,
          role: member.role,
        })),
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

const memberChangeFailureHandlers = <A>(toMessage: (failure: MemberChangeFailure) => A) => {
  const failed = (failure: MemberChangeFailure) => () => Effect.succeed(toMessage(failure));
  return {
    Forbidden: failed("Forbidden"),
    NotFound: failed("NotFound"),
    LastOwner: failed("LastOwner"),
    Unauthorized: failed("Unauthorized"),
    HttpClientError: failed("Unexpected"),
    SchemaError: failed("Unexpected"),
  };
};

export const ChangeRole = Command.define("ChangeRole", {
  args: { visit: Schema.Int, companyId: Schema.String, member: Member, role: RoleSchema },
  messages: [Message.SucceededChangeRole, Message.FailedChangeRole],
  execute: ({ visit, companyId, member, role }) =>
    Effect.gen(function* () {
      const client = yield* SpaHttpClient;
      yield* client.membership.changeRole({
        params: { companyId, targetUserId: member.userId },
        payload: { role },
      });
      return Message.SucceededChangeRole({
        visit,
        texts: {
          doneText: `${member.label} の役割を${roleLabelJa(role)}に変更しました。`,
          actionText: "役割を変更しました",
        },
      });
    }).pipe(
      Effect.catchTags(
        memberChangeFailureHandlers((failure) => Message.FailedChangeRole({ visit, failure })),
      ),
    ),
});

export const RemoveMember = Command.define("RemoveMember", {
  args: { visit: Schema.Int, companyId: Schema.String, member: Member },
  messages: [Message.SucceededRemoveMember, Message.FailedRemoveMember],
  execute: ({ visit, companyId, member }) =>
    Effect.gen(function* () {
      const client = yield* SpaHttpClient;
      const { account_deleted } = yield* client.membership.remove({
        params: { companyId, targetUserId: member.userId },
      });
      return Message.SucceededRemoveMember({ visit, texts: textsAfterRemoval(account_deleted) });
    }).pipe(
      Effect.catchTags(
        memberChangeFailureHandlers((failure) => Message.FailedRemoveMember({ visit, failure })),
      ),
    ),
});

const DIALOG_ID = "member-removal-dialog";

const toInvitationsMessage = (message: MemberInvitations.Message) =>
  Message.GotMemberInvitationsMessage({ message });

const canManage = (role: Role) => isAtLeast(role, "ADMIN");

const assignableRolesOf = (actorRole: Role): ReadonlyArray<Role> =>
  ROLES_IN_SELECT_ORDER.filter((role) => canInviteRole(actorRole, role));

export const init = (
  visit: number,
  maybeCurrentMembership: Option.Option<CurrentCompany.Membership>,
  redirectSearch: MemberInvitations.RedirectSearch,
): Update.Return<Model, Message, SpaHttpClient> =>
  Option.match(maybeCurrentMembership, {
    onNone: () => ({ model: { visit, page: Page.NoCompany() } }),
    onSome: ({ companyId, role }) => {
      const maybeInvitationsInit = canManage(role)
        ? Option.some(
            MemberInvitations.init({
              visit,
              companyId,
              assignableRoles: assignableRolesOf(role),
              redirectSearch,
            }),
          )
        : Option.none();
      return {
        model: {
          visit,
          page: Page.Listing({
            companyId,
            actorRole: role,
            maybeSelfUserId: Option.none(),
            members: Members.Loading(),
            busy: Busy.Idle(),
            maybeRemovalTarget: Option.none(),
            dialog: ReportingDialog.init({ id: DIALOG_ID }),
            maybeInvitations: Option.map(
              maybeInvitationsInit,
              (invitationsInit) => invitationsInit.model,
            ),
          }),
        },
        commands: [
          ReadSelfUserId({ visit }),
          LoadMembers({ visit, companyId, reload: Reload.Opened() }),
          ...Option.match(maybeInvitationsInit, {
            onNone: () => [],
            onSome: (invitationsInit) =>
              Command.mapMessages(invitationsInit.commands, toInvitationsMessage),
          }),
        ],
      };
    },
  });

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, SpaHttpClient>;
type ListingReturn = Update.ReturnWithOutMessage<Listing, Message, OutMessage, SpaHttpClient>;

const withListing = (
  model: Model,
  visit: number,
  next: (listing: Listing) => ListingReturn,
): UpdateReturn =>
  visit === model.visit
    ? Page.matchOrElse(
        model.page,
        {
          Listing: (listing) => {
            const result = next(listing);
            return {
              ...result,
              model: modifyFields(model, { page: () => Page.Listing(result.model) }),
            };
          },
        },
        () => ({ model }),
      )
    : { model };

const isBusy = (listing: Listing) => !Busy.guards.Idle(listing.busy);

export const isSubmitting = (model: Model): boolean =>
  Page.match(model.page, {
    NoCompany: () => false,
    Listing: (listing) =>
      isBusy(listing) ||
      Option.exists(listing.maybeInvitations, MemberInvitations.isSendingOrRevoking),
  });

const toDialogMessage = (message: DialogMessage) => Message.GotDialogMessage({ message });

const dialogFolds = reportingDialogFoldsOf<OutMessage>()({
  isClosingBlocked: (listing: Listing) => Busy.guards.Removing(listing.busy),
  toParentMessage: toDialogMessage,
  whenClosed: (listing) =>
    Busy.guards.Removing(listing.busy)
      ? modifyFields(listing, { busy: () => Busy.Idle() })
      : listing,
});

const finishReload = (
  listing: Listing,
  reload: Reload,
  noticeOf: (texts: ReloadTexts) => OutMessage,
): ListingReturn =>
  Reload.match<ListingReturn>(reload, {
    Opened: () => ({ model: listing }),
    ChangedRole: ({ texts }) => ({
      model: modifyFields(listing, { busy: () => Busy.Idle() }),
      outMessage: noticeOf(texts),
    }),
    Removed: ({ texts }) => dialogFolds.closeThen(listing, noticeOf(texts)),
  });

const reloadMembers = (visit: number, listing: Listing, reload: Reload): ListingReturn => ({
  model: listing,
  commands: [LoadMembers({ visit, companyId: listing.companyId, reload })],
});

const selectRole = (
  visit: number,
  listing: Listing,
  member: Member,
  value: string,
): ListingReturn =>
  pipe(
    Array.findFirst(assignableRolesOf(listing.actorRole), (role) => role === value),
    Option.filter((role) => role !== member.role && !isBusy(listing)),
    Option.match({
      onNone: () => ({ model: listing }),
      onSome: (role) => ({
        model: modifyFields(listing, { busy: () => Busy.ChangingRole({ userId: member.userId }) }),
        commands: [ChangeRole({ visit, companyId: listing.companyId, member, role })],
      }),
    }),
  );

const confirmRemoval = (visit: number, listing: Listing): ListingReturn =>
  Option.match(
    Option.filter(listing.maybeRemovalTarget, () => !isBusy(listing)),
    {
      onNone: () => ({ model: listing }),
      onSome: (member) => ({
        model: modifyFields(listing, { busy: () => Busy.Removing({ userId: member.userId }) }),
        commands: [RemoveMember({ visit, companyId: listing.companyId, member })],
      }),
    },
  );

const finishFailedChange = (
  listing: Listing,
  failure: MemberChangeFailure,
  messages: Readonly<Record<Exclude<MemberChangeFailure, "Unauthorized">, string>>,
  notify: (listing: Listing, notice: OutMessage) => ListingReturn,
): ListingReturn =>
  failure === "Unauthorized"
    ? { model: listing, outMessage: OutMessage.RequiredSignIn() }
    : notify(listing, OutMessage.Notified({ tone: "Error", text: messages[failure] }));

const foldInvitations = Update.foldChild({
  update: MemberInvitations.update,
  read: (listing: Listing) => listing.maybeInvitations,
  write: (listing: Listing, next: MemberInvitations.Model) =>
    modifyFields(listing, { maybeInvitations: () => Option.some(next) }),
  toParentMessage: toInvitationsMessage,
  toParentOutMessage: MemberInvitations.OutMessage.match<OutMessage>({
    Notified: ({ tone, text }) => OutMessage.Notified({ tone, text }),
    RequiredSignIn: () => OutMessage.RequiredSignIn(),
  }),
});

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    CompletedReadSelfUserId: ({ visit, maybeUserId }) =>
      withListing(model, visit, (listing) => ({
        model: modifyFields(listing, { maybeSelfUserId: () => maybeUserId }),
      })),
    SucceededLoadMembers: ({ visit, members, reload }) =>
      withListing(model, visit, (listing) =>
        finishReload(
          modifyFields(listing, { members: () => Members.Loaded({ members }) }),
          reload,
          ({ doneText }) => OutMessage.Notified({ tone: "Success", text: doneText }),
        ),
      ),
    FailedLoadMembers: ({ visit, failure, reload }) =>
      withListing(model, visit, (listing) =>
        failure === "Unauthorized"
          ? { model: listing, outMessage: OutMessage.RequiredSignIn() }
          : finishReload(
              Members.guards.Loaded(listing.members)
                ? listing
                : modifyFields(listing, { members: () => Members.Failed() }),
              reload,
              ({ actionText }) =>
                OutMessage.Notified({ tone: "Error", text: staleNoticeOf(actionText) }),
            ),
      ),
    SelectedRole: ({ member, value }) =>
      withListing(model, model.visit, (listing) => selectRole(model.visit, listing, member, value)),
    SucceededChangeRole: ({ visit, texts }) =>
      withListing(model, visit, (listing) =>
        reloadMembers(visit, listing, Reload.ChangedRole({ texts })),
      ),
    FailedChangeRole: ({ visit, failure }) =>
      withListing(model, visit, (listing) =>
        finishFailedChange(
          listing,
          failure,
          ROLE_CHANGE_FAILURE_MESSAGES,
          (changing, outMessage) => ({
            model: modifyFields(changing, { busy: () => Busy.Idle() }),
            outMessage,
          }),
        ),
      ),
    ClickedRemove: ({ member }) =>
      withListing(model, model.visit, (listing) =>
        isBusy(listing)
          ? { model: listing }
          : dialogFolds.open(
              modifyFields(listing, { maybeRemovalTarget: () => Option.some(member) }),
            ),
      ),
    ClickedCancelRemoval: () =>
      withListing(model, model.visit, (listing) =>
        Busy.guards.Removing(listing.busy) ? { model: listing } : dialogFolds.close(listing),
      ),
    ClickedConfirmRemoval: () =>
      withListing(model, model.visit, (listing) => confirmRemoval(model.visit, listing)),
    SucceededRemoveMember: ({ visit, texts }) =>
      withListing(model, visit, (listing) =>
        reloadMembers(visit, listing, Reload.Removed({ texts })),
      ),
    FailedRemoveMember: ({ visit, failure }) =>
      withListing(model, visit, (listing) =>
        finishFailedChange(listing, failure, REMOVAL_FAILURE_MESSAGES, dialogFolds.closeThen),
      ),
    GotDialogMessage: ({ message: dialogMessage }) =>
      withListing(model, model.visit, (listing) => dialogFolds.fold(listing, dialogMessage)),
    GotMemberInvitationsMessage: ({ message: invitationsMessage }) =>
      withListing(model, model.visit, (listing) => foldInvitations(listing, invitationsMessage)),
  });

const isSelf = (listing: Listing, member: Member) =>
  Option.contains(listing.maybeSelfUserId, member.userId);

const canOperateOn = (listing: Listing, member: Member) =>
  canManage(listing.actorRole) &&
  Option.isSome(listing.maybeSelfUserId) &&
  !isSelf(listing, member) &&
  assignableRolesOf(listing.actorRole).includes(member.role);

const isBusyWith = (busy: Busy, member: Member) =>
  Busy.matchOrElse(
    busy,
    {
      ChangingRole: ({ userId }) => userId === member.userId,
      Removing: ({ userId }) => userId === member.userId,
    },
    () => false,
  );

const operationsView = (
  listing: Listing,
  isCompanyChanging: boolean,
  member: Member,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  canOperateOn(listing, member)
    ? [
        fieldSelectView(
          {
            id: `member-role-${member.userId}`,
            label: { _tag: "AriaOnly", text: `${member.email} の役割` },
            value: member.role,
            options: assignableRolesOf(listing.actorRole).map((role) => ({
              value: role,
              label: roleLabelJa(role),
            })),
            isDisabled: isCompanyChanging || isBusy(listing),
            onChange: (value) => Message.SelectedRole({ member, value }),
            placement: "InRow",
          },
          h,
        ),
        buttonView(
          {
            label: "削除",
            type: "button",
            look: "ghostSmall",
            submission: Submission.Idle(),
            isBlocked: isCompanyChanging || isBusy(listing),
            onClick: Message.ClickedRemove({ member }),
          },
          h,
        ),
      ]
    : [h.span([h.Class("text-xs font-medium text-muted-foreground")], [roleLabelJa(member.role)])];

const memberRowView = (
  listing: Listing,
  isCompanyChanging: boolean,
  member: Member,
  h: HtmlBuilder<Message>,
): Html =>
  h.keyed("li")(
    member.userId,
    [
      h.Class(
        "flex items-center justify-between gap-3 rounded-md border border-border px-4 py-3 text-sm",
      ),
    ],
    [
      h.div(
        [h.Class("min-w-0")],
        [
          h.p(
            [h.Class("truncate font-medium text-foreground")],
            [
              member.label,
              ...(isSelf(listing, member)
                ? [h.span([h.Class("ml-2 text-xs text-muted-foreground")], ["(自分)"])]
                : []),
            ],
          ),
          h.p([h.Class("truncate text-xs text-muted-foreground")], [member.email]),
        ],
      ),
      h.div(
        [h.Class("flex shrink-0 items-center gap-2")],
        [
          ...(isBusyWith(listing.busy, member)
            ? [h.span([h.Class("size-4 text-muted-foreground")], [spinnerView(h)])]
            : []),
          ...operationsView(listing, isCompanyChanging, member, h),
        ],
      ),
    ],
  );

const membersListView = (
  listing: Listing,
  isCompanyChanging: boolean,
  members: ReadonlyArray<Member>,
  failureAlerts: ReadonlyArray<Html>,
  h: HtmlBuilder<Message>,
): Html =>
  h.section(
    [h.AriaLabel("メンバー一覧")],
    [
      ...failureAlerts,
      h.ul(
        [h.Role("list"), h.Class("space-y-2")],
        members.map((member) => memberRowView(listing, isCompanyChanging, member, h)),
      ),
    ],
  );

const membersView = (listing: Listing, isCompanyChanging: boolean, h: HtmlBuilder<Message>): Html =>
  Members.match(listing.members, {
    Loading: () => listLoadingStatusView("読み込み中…", h),
    Failed: () =>
      membersListView(
        listing,
        isCompanyChanging,
        [],
        [alertTextView("メンバーの一覧を取得できませんでした。", h)],
        h,
      ),
    Loaded: ({ members }) => membersListView(listing, isCompanyChanging, members, [], h),
  });

const removalDialogView = (
  listing: Listing,
  isCompanyChanging: boolean,
  h: HtmlBuilder<Message>,
): Html =>
  dialogView(
    listing.dialog,
    toDialogMessage,
    {
      title: "メンバーの削除",
      description: Option.match(listing.maybeRemovalTarget, {
        onNone: () => "",
        onSome: (member) =>
          `${member.label} をこの事業所から削除します。このメンバーが他の事業所に所属していない場合、アカウントごと削除されます。`,
      }),
      body: [
        dialogFooterView(
          [
            buttonView(
              {
                label: "キャンセル",
                type: "button",
                look: "outlineInline",
                submission: Submission.Idle(),
                isBlocked: Busy.guards.Removing(listing.busy),
                onClick: Message.ClickedCancelRemoval(),
              },
              h,
            ),
            buttonView(
              {
                label: "削除する",
                type: "button",
                look: "destructive",
                submission: Busy.guards.Removing(listing.busy)
                  ? Submission.Submitting()
                  : Submission.Idle(),
                isBlocked: isCompanyChanging,
                onClick: Message.ClickedConfirmRemoval(),
              },
              h,
            ),
          ],
          h,
        ),
      ],
      isClosingBlocked: Busy.guards.Removing(listing.busy),
    },
    h,
  );

const listingView = (listing: Listing, isCompanyChanging: boolean, h: HtmlBuilder<Message>): Html =>
  h.div(
    [],
    [
      ...accountPageHeaderView("メンバー", "事業所のメンバー一覧と招待", h),
      membersView(listing, isCompanyChanging, h),
      removalDialogView(listing, isCompanyChanging, h),
      ...Option.match(listing.maybeInvitations, {
        onNone: () => [],
        onSome: (invitations) => [
          separatorView("my-8", h),
          h.submodel({
            slotId: "member-invitations",
            view: MemberInvitations.view,
            model: invitations,
            viewInputs: { isCompanyChanging },
            toParentMessage: toInvitationsMessage,
          }),
        ],
      }),
    ],
  );

type ViewInputs = Readonly<{ currentCompany: CurrentCompany.Model }>;

export const view = Submodel.defineView<Model, Message, ViewInputs>(
  (model, { currentCompany }, h) =>
    Page.match(model.page, {
      NoCompany: () => listEmptyView("事業所が見つかりません。", h),
      Listing: (listing) => listingView(listing, CurrentCompany.isBusy(currentCompany), h),
    }),
);
