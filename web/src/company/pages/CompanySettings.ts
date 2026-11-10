import { Effect, Option, Schema, String } from "effect";
import { Command, Submodel, Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { defineTaggedUnion } from "foldkit/schema";
import { modifyFields } from "foldkit/struct";

import { OrgCodeSchema } from "@core/company/company-contract";

import { accountPageHeaderView, separatorView } from "../../account/account-page-header-view";
import * as CurrentCompany from "../../account/current-company";
import type { FailureMessages } from "../../shared/failure-message";
import { type DeclaredFailure, SpaHttpClient } from "../../shared/spa-http-client";
import { Submission } from "../../shared/submission";
import { buttonView } from "../../shared/ui/button-view";
import { inputView } from "../../shared/ui/input-view";
import { radioFieldsetView } from "../../shared/ui/radio-fieldset-view";
import { orgCodeOptionsIn } from "../org-code-options";
import { NoticeTone } from "../../shared/ui/toast-view";
import * as CompanyDeletion from "../company-deletion";

const Editing = Schema.Struct({
  companyId: Schema.String,
  nameDraft: Schema.String,
  orgCode: OrgCodeSchema,
  save: Submission,
  deletion: CompanyDeletion.Model,
});
type Editing = typeof Editing.Type;

const Settings = defineTaggedUnion({
  NotOwner: {},
  Editing: Editing.fields,
});

export const Model = Schema.Struct({
  visit: Schema.Int,
  settings: Settings,
});
export type Model = typeof Model.Type;

const UpdateCompanyFailure = Schema.Literals([
  "Forbidden",
  "NotFound",
  "Unauthorized",
  "Unexpected",
]);
type UpdateCompanyFailure = typeof UpdateCompanyFailure.Type;

export const Message = defineMessageUnion({
  UpdatedName: { value: Schema.String },
  SelectedOrgCode: { orgCode: OrgCodeSchema },
  SubmittedCompanyForm: {},
  SucceededUpdateCompany: { visit: Schema.Int },
  FailedUpdateCompany: { visit: Schema.Int, failure: UpdateCompanyFailure },
  GotCompanyDeletionMessage: { message: CompanyDeletion.Message },
});
export type Message = typeof Message.Type;

export const isLastCompanyDeleted = (message: Message): boolean =>
  Schema.is(Message.GotCompanyDeletionMessage)(message) &&
  Schema.is(CompanyDeletion.Message.SucceededDeleteLastCompany)(message.message);

export const OutMessage = defineMessageUnion({
  Notified: { tone: NoticeTone, text: Schema.String },
  RequiredSignIn: {},
  UpdatedCompanyState: { texts: CurrentCompany.RefreshTexts },
  DeletedCompany: { companyName: Schema.String },
});
export type OutMessage = typeof OutMessage.Type;

type ViewInputs = Readonly<{ currentCompany: CurrentCompany.Model }>;

const UPDATE_FAILED = "更新に失敗しました。";

const DECLARED_FAILURE_MESSAGES: FailureMessages<DeclaredFailure<"company", "update">> = {
  Forbidden: "編集する権限がありません。",
  NotFound: UPDATE_FAILED,
};

const FAILURE_MESSAGES = { ...DECLARED_FAILURE_MESSAGES, Unexpected: UPDATE_FAILED };

const AFTER_UPDATE: CurrentCompany.RefreshTexts = {
  maybeDoneText: Option.some("事業所情報を更新しました。"),
  actionText: "事業所情報を更新しました",
};

const ORG_CODE_OPTIONS = orgCodeOptionsIn(OrgCodeSchema.literals);

const failedUpdateCompany = (visit: number, failure: UpdateCompanyFailure) => () =>
  Effect.succeed(Message.FailedUpdateCompany({ visit, failure }));

export const UpdateCompany = Command.define("UpdateCompany", {
  args: {
    visit: Schema.Int,
    companyId: Schema.String,
    name: Schema.String,
    orgCode: OrgCodeSchema,
  },
  messages: [Message.SucceededUpdateCompany, Message.FailedUpdateCompany],
  execute: ({ visit, companyId, name, orgCode }) =>
    Effect.gen(function* () {
      const client = yield* SpaHttpClient;
      yield* client.company.update({
        params: { companyId },
        payload: { name, org_code: orgCode },
      });
      return Message.SucceededUpdateCompany({ visit });
    }).pipe(
      Effect.catchTags({
        Forbidden: failedUpdateCompany(visit, "Forbidden"),
        NotFound: failedUpdateCompany(visit, "NotFound"),
        Unauthorized: failedUpdateCompany(visit, "Unauthorized"),
        HttpClientError: failedUpdateCompany(visit, "Unexpected"),
        SchemaError: failedUpdateCompany(visit, "Unexpected"),
      }),
    ),
});

export const init = (
  visit: number,
  maybeCurrentMembership: Option.Option<CurrentCompany.Membership>,
): Model => ({
  visit,
  settings: Option.match(
    Option.filter(maybeCurrentMembership, (membership) => membership.role === "OWNER"),
    {
      onNone: () => Settings.NotOwner(),
      onSome: (membership) =>
        Settings.Editing({
          companyId: membership.companyId,
          nameDraft: membership.companyName,
          orgCode: membership.orgCode,
          save: Submission.Idle(),
          deletion: CompanyDeletion.init({ visit, companyId: membership.companyId }),
        }),
    },
  ),
});

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, SpaHttpClient>;
type Step = Update.StepWithOutMessage<Model, Message, OutMessage, SpaHttpClient>;

const withEditing = (model: Model, next: (editing: Editing) => UpdateReturn): UpdateReturn =>
  Settings.matchOrElse(model.settings, { Editing: next }, () => ({ model }));

const withSettings = (model: Model, editing: Editing): Model =>
  modifyFields(model, { settings: () => Settings.Editing(editing) });

export const isSubmitting = (model: Model): boolean =>
  Settings.matchOrElse(
    model.settings,
    {
      Editing: ({ save, deletion }) =>
        Submission.guards.Submitting(save) || CompanyDeletion.isDeleting(deletion),
    },
    () => false,
  );

const whileEditable = (model: Model, next: (editing: Editing) => UpdateReturn): UpdateReturn =>
  withEditing(model, (editing) =>
    Submission.guards.Submitting(editing.save) ? { model } : next(editing),
  );

const submitCompanyForm = (model: Model): UpdateReturn =>
  whileEditable(model, (editing) => {
    const name = String.trim(editing.nameDraft);
    return String.isEmpty(name)
      ? { model }
      : {
          model: withSettings(
            model,
            modifyFields(editing, { save: () => Submission.Submitting() }),
          ),
          commands: [
            UpdateCompany({
              visit: model.visit,
              companyId: editing.companyId,
              name,
              orgCode: editing.orgCode,
            }),
          ],
        };
  });

const finishUpdate = (model: Model, visit: number, outMessage: OutMessage): UpdateReturn =>
  visit === model.visit
    ? withEditing(model, (editing) =>
        Submission.guards.Submitting(editing.save)
          ? {
              model: withSettings(model, modifyFields(editing, { save: () => Submission.Idle() })),
              outMessage,
            }
          : { model },
      )
    : { model };

const failureOutMessage = (failure: UpdateCompanyFailure): OutMessage =>
  failure === "Unauthorized"
    ? OutMessage.RequiredSignIn()
    : OutMessage.Notified({ tone: "Error", text: FAILURE_MESSAGES[failure] });

const foldCompanyDeletion = Update.foldChild({
  update: CompanyDeletion.update,
  read: (model: Model) =>
    Settings.matchOrElse(model.settings, { Editing: ({ deletion }) => Option.some(deletion) }, () =>
      Option.none(),
    ),
  write: (model: Model, nextDeletion: CompanyDeletion.Model) =>
    Settings.matchOrElse(
      model.settings,
      {
        Editing: (editing) =>
          withSettings(model, modifyFields(editing, { deletion: () => nextDeletion })),
      },
      () => model,
    ),
  toParentMessage: (message: CompanyDeletion.Message) =>
    Message.GotCompanyDeletionMessage({ message }),
  foldOutMessage: CompanyDeletion.OutMessage.match<Step>({
    DeletedCompany:
      ({ companyName }) =>
      (model) => ({ model, outMessage: OutMessage.DeletedCompany({ companyName }) }),
    Notified:
      ({ tone, text }) =>
      (model) => ({ model, outMessage: OutMessage.Notified({ tone, text }) }),
    RequiredSignIn: () => (model) => ({ model, outMessage: OutMessage.RequiredSignIn() }),
  }),
});

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    UpdatedName: ({ value }) =>
      whileEditable(model, (editing) => ({
        model: withSettings(model, modifyFields(editing, { nameDraft: () => value })),
      })),
    SelectedOrgCode: ({ orgCode }) =>
      whileEditable(model, (editing) => ({
        model: withSettings(model, modifyFields(editing, { orgCode: () => orgCode })),
      })),
    SubmittedCompanyForm: () => submitCompanyForm(model),
    SucceededUpdateCompany: ({ visit }) =>
      finishUpdate(model, visit, OutMessage.UpdatedCompanyState({ texts: AFTER_UPDATE })),
    FailedUpdateCompany: ({ visit, failure }) =>
      finishUpdate(model, visit, failureOutMessage(failure)),
    GotCompanyDeletionMessage: ({ message: deletionMessage }) =>
      foldCompanyDeletion(model, deletionMessage),
  });

const companyFormView = (
  editing: Editing,
  isCompanyChanging: boolean,
  h: HtmlBuilder<Message>,
): Html =>
  h.form(
    [h.Class("max-w-md space-y-4"), h.OnSubmit(Message.SubmittedCompanyForm())],
    [
      inputView(
        {
          id: "company-name",
          label: "事業所名",
          type: "text",
          value: editing.nameDraft,
          onInput: (value) => Message.UpdatedName({ value }),
          submission: editing.save,
          placeholder: "",
          maxLength: 100,
        },
        h,
      ),
      radioFieldsetView(
        {
          id: "org_code",
          legend: "事業形態",
          name: "org_code",
          options: ORG_CODE_OPTIONS,
          selected: editing.orgCode,
          onSelect: (orgCode) => Message.SelectedOrgCode({ orgCode }),
          isDisabled: Submission.guards.Submitting(editing.save),
        },
        h,
      ),
      buttonView(
        {
          label: "保存",
          type: "submit",
          look: "primaryInline",
          submission: editing.save,
          isBlocked: isCompanyChanging || String.isEmpty(String.trim(editing.nameDraft)),
        },
        h,
      ),
    ],
  );

const editingView = (
  editing: Editing,
  currentCompany: CurrentCompany.Model,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [],
    [
      ...accountPageHeaderView("事業所設定", "事業所名と事業形態の編集", h),
      companyFormView(editing, CurrentCompany.isBusy(currentCompany), h),
      separatorView("my-10", h),
      h.submodel({
        slotId: "company-deletion",
        view: CompanyDeletion.view,
        model: editing.deletion,
        viewInputs: {
          companyName: Option.match(CurrentCompany.maybeCurrentMembership(currentCompany.state), {
            onNone: () => editing.nameDraft,
            onSome: (membership) => membership.companyName,
          }),
          isLastCompany: currentCompany.state.memberships.length <= 1,
          isBlocked:
            Submission.guards.Submitting(editing.save) || CurrentCompany.isBusy(currentCompany),
        },
        toParentMessage: (message) => Message.GotCompanyDeletionMessage({ message }),
      }),
    ],
  );

export const view = Submodel.defineView<Model, Message, ViewInputs>(
  (model, { currentCompany }, h) =>
    Settings.match(model.settings, {
      NotOwner: () =>
        h.p(
          [h.Class("text-sm text-muted-foreground")],
          ["事業所設定の編集はオーナーのみ可能です。"],
        ),
      Editing: (editing) => editingView(editing, currentCompany, h),
    }),
);
