import { Array, Effect, Match, Option, Schema, String } from "effect";
import { Command, Submodel, type Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { defineTaggedUnion } from "foldkit/schema";
import { modifyFields } from "foldkit/struct";

import { OrgCodeSchema } from "@core/company/company-contract";
import { orgCodeLabelJa } from "@core/company/org-code";

import { authPageCardView } from "../../auth/auth-page-card-view";
import { signInClient } from "../../auth/sign-in-client";
import { SIGN_OUT_FAILED, signOut } from "../../auth/sign-out";
import { SpaHttpClient } from "../../shared/spa-http-client";
import { maybeRejectedMessage, Submission } from "../../shared/submission";
import { buttonView } from "../../shared/ui/button-view";
import { fullScreenStatusView } from "../../shared/ui/icon-view";
import { inputView } from "../../shared/ui/input-view";
import { radioFieldsetView } from "../../shared/ui/radio-fieldset-view";

const LoadMembershipsFailure = Schema.Literals(["Unauthorized", "Unexpected"]);

const CreateCompanyFailure = Schema.Literals(["AlreadyExists", "Unauthorized", "Unexpected"]);

const Phase = defineTaggedUnion({
  Checking: {},
  Editing: {
    name: Schema.String,
    orgCode: OrgCodeSchema,
    creation: Submission,
    signOut: Submission,
  },
});
type Phase = typeof Phase.Type;
type Editing = typeof Phase.Editing.Type;

export const Model = Schema.Struct({
  visit: Schema.Int,
  redirectUrl: Schema.String,
  phase: Phase,
});
export type Model = typeof Model.Type;

export const Message = defineMessageUnion({
  SucceededCheckSession: { visit: Schema.Int, isSignedIn: Schema.Boolean },
  FailedCheckSession: { visit: Schema.Int },
  SucceededLoadMemberships: { visit: Schema.Int, isCompanyMember: Schema.Boolean },
  FailedLoadMemberships: { visit: Schema.Int, failure: LoadMembershipsFailure },
  UpdatedName: { value: Schema.String },
  SelectedOrgCode: { orgCode: OrgCodeSchema },
  SubmittedCompanyForm: {},
  SucceededCreateCompany: { visit: Schema.Int },
  FailedCreateCompany: { visit: Schema.Int, failure: CreateCompanyFailure },
  ClickedSignOut: {},
  SucceededSignOut: { visit: Schema.Int },
  FailedSignOut: { visit: Schema.Int },
});
export type Message = typeof Message.Type;

export const OutMessage = defineMessageUnion({
  ConfirmedCompanyMembership: { redirectUrl: Schema.String },
  RequiredSignIn: {},
  SignedOut: {},
});
export type OutMessage = typeof OutMessage.Type;

const CREATE_FAILED_MESSAGE = "事業所登録に失敗しました";

const ORG_CODE_OPTIONS = OrgCodeSchema.literals.map((orgCode) => ({
  value: orgCode,
  label: orgCodeLabelJa(orgCode),
}));

export const CheckSession = Command.define("CheckSession", {
  args: { visit: Schema.Int },
  messages: [Message.SucceededCheckSession, Message.FailedCheckSession],
  execute: ({ visit }) =>
    Effect.tryPromise(() => signInClient.getSession()).pipe(
      Effect.map(({ data }) =>
        Message.SucceededCheckSession({ visit, isSignedIn: Boolean(data?.session) }),
      ),
      Effect.catchTag("UnknownError", () => Effect.succeed(Message.FailedCheckSession({ visit }))),
    ),
});

const failedLoadMemberships = (visit: number, failure: typeof LoadMembershipsFailure.Type) => () =>
  Effect.succeed(Message.FailedLoadMemberships({ visit, failure }));

export const LoadMemberships = Command.define("LoadMemberships", {
  args: { visit: Schema.Int },
  messages: [Message.SucceededLoadMemberships, Message.FailedLoadMemberships],
  execute: ({ visit }) =>
    Effect.gen(function* () {
      const client = yield* SpaHttpClient;
      const { memberships } = yield* client.account.memberships();
      return Message.SucceededLoadMemberships({
        visit,
        isCompanyMember: Array.isReadonlyArrayNonEmpty(memberships),
      });
    }).pipe(
      Effect.catchTags({
        Unauthorized: failedLoadMemberships(visit, "Unauthorized"),
        HttpClientError: failedLoadMemberships(visit, "Unexpected"),
        SchemaError: failedLoadMemberships(visit, "Unexpected"),
      }),
    ),
});

const failedCreateCompany = (visit: number, failure: typeof CreateCompanyFailure.Type) => () =>
  Effect.succeed(Message.FailedCreateCompany({ visit, failure }));

export const CreateCompany = Command.define("CreateCompany", {
  args: { visit: Schema.Int, name: Schema.String, orgCode: OrgCodeSchema },
  messages: [Message.SucceededCreateCompany, Message.FailedCreateCompany],
  execute: ({ visit, name, orgCode }) =>
    Effect.gen(function* () {
      const client = yield* SpaHttpClient;
      yield* client.company.create({ payload: { name, org_code: orgCode } });
      return Message.SucceededCreateCompany({ visit });
    }).pipe(
      Effect.catchTags({
        AlreadyExists: failedCreateCompany(visit, "AlreadyExists"),
        Unauthorized: failedCreateCompany(visit, "Unauthorized"),
        HttpClientError: failedCreateCompany(visit, "Unexpected"),
        SchemaError: failedCreateCompany(visit, "Unexpected"),
      }),
    ),
});

export const SignOut = Command.define("SignOut", {
  args: { visit: Schema.Int },
  messages: [Message.SucceededSignOut, Message.FailedSignOut],
  execute: ({ visit }) =>
    Effect.promise(() => signOut()).pipe(
      Effect.map((result) =>
        result === "signedOut"
          ? Message.SucceededSignOut({ visit })
          : Message.FailedSignOut({ visit }),
      ),
    ),
});

export const init = (
  start: Readonly<{ visit: number; redirectUrl: string }>,
): Update.Return<Model, Message, SpaHttpClient> => ({
  model: { ...start, phase: Phase.Checking() },
  commands: [CheckSession({ visit: start.visit })],
});

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, SpaHttpClient>;

const startEditing = (): Phase =>
  Phase.Editing({
    name: "",
    orgCode: "PERSONAL",
    creation: Submission.Idle(),
    signOut: Submission.Idle(),
  });

const withoutRejection = (submission: Submission): Submission =>
  Submission.guards.Rejected(submission) ? Submission.Idle() : submission;

const withPhase = (model: Model, phase: Phase): Model =>
  modifyFields(model, { phase: () => phase });

const forThisVisit = (model: Model, visit: number, next: () => UpdateReturn): UpdateReturn =>
  visit === model.visit ? next() : { model };

const withChecking = (model: Model, next: () => UpdateReturn): UpdateReturn =>
  Phase.matchOrElse(model.phase, { Checking: next }, () => ({ model }));

const withEditing = (model: Model, next: (editing: Editing) => UpdateReturn): UpdateReturn =>
  Phase.matchOrElse(model.phase, { Editing: next }, () => ({ model }));

const whileEditable = (model: Model, next: (editing: Editing) => UpdateReturn): UpdateReturn =>
  withEditing(model, (editing) =>
    Submission.guards.Submitting(editing.creation) ? { model } : next(editing),
  );

const finishSignup = (model: Model): UpdateReturn => ({
  model,
  outMessage: OutMessage.ConfirmedCompanyMembership({ redirectUrl: model.redirectUrl }),
});

const requireSignIn = (model: Model): UpdateReturn => ({
  model,
  outMessage: OutMessage.RequiredSignIn(),
});

const submitCompanyForm = (model: Model): UpdateReturn =>
  whileEditable(model, (editing) => {
    const name = String.trim(editing.name);
    if (String.isEmpty(name)) {
      return { model };
    } else {
      return {
        model: withPhase(
          model,
          modifyFields(editing, {
            creation: () => Submission.Submitting(),
            signOut: withoutRejection,
          }),
        ),
        commands: [CreateCompany({ visit: model.visit, name, orgCode: editing.orgCode })],
      };
    }
  });

const failCreateCompany = (
  model: Model,
  editing: Editing,
  failure: typeof CreateCompanyFailure.Type,
): UpdateReturn =>
  Match.value(failure).pipe(
    Match.withReturnType<UpdateReturn>(),
    Match.when("AlreadyExists", () => finishSignup(model)),
    Match.when("Unauthorized", () => requireSignIn(model)),
    Match.when("Unexpected", () => ({
      model: withPhase(
        model,
        modifyFields(editing, {
          creation: () => Submission.Rejected({ message: CREATE_FAILED_MESSAGE }),
        }),
      ),
    })),
    Match.exhaustive,
  );

const failLoadMemberships = (
  model: Model,
  failure: typeof LoadMembershipsFailure.Type,
): UpdateReturn =>
  Match.value(failure).pipe(
    Match.withReturnType<UpdateReturn>(),
    Match.when("Unauthorized", () => requireSignIn(model)),
    Match.when("Unexpected", () => ({ model: withPhase(model, startEditing()) })),
    Match.exhaustive,
  );

const startSignOut = (model: Model): UpdateReturn =>
  withEditing(model, (editing) =>
    Submission.guards.Submitting(editing.signOut)
      ? { model }
      : {
          model: withPhase(
            model,
            modifyFields(editing, {
              signOut: () => Submission.Submitting(),
              creation: withoutRejection,
            }),
          ),
          commands: [SignOut({ visit: model.visit })],
        },
  );

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    SucceededCheckSession: ({ visit, isSignedIn }) =>
      forThisVisit(model, visit, () =>
        withChecking(model, () =>
          isSignedIn
            ? { model, commands: [LoadMemberships({ visit: model.visit })] }
            : requireSignIn(model),
        ),
      ),
    FailedCheckSession: ({ visit }) =>
      forThisVisit(model, visit, () =>
        withChecking(model, () => ({ model: withPhase(model, startEditing()) })),
      ),
    SucceededLoadMemberships: ({ visit, isCompanyMember }) =>
      forThisVisit(model, visit, () =>
        withChecking(model, () =>
          isCompanyMember ? finishSignup(model) : { model: withPhase(model, startEditing()) },
        ),
      ),
    FailedLoadMemberships: ({ visit, failure }) =>
      forThisVisit(model, visit, () =>
        withChecking(model, () => failLoadMemberships(model, failure)),
      ),
    UpdatedName: ({ value }) =>
      whileEditable(model, (editing) => ({
        model: withPhase(model, modifyFields(editing, { name: () => value })),
      })),
    SelectedOrgCode: ({ orgCode }) =>
      whileEditable(model, (editing) => ({
        model: withPhase(model, modifyFields(editing, { orgCode: () => orgCode })),
      })),
    SubmittedCompanyForm: () => submitCompanyForm(model),
    SucceededCreateCompany: ({ visit }) =>
      forThisVisit(model, visit, () => withEditing(model, () => finishSignup(model))),
    FailedCreateCompany: ({ visit, failure }) =>
      forThisVisit(model, visit, () =>
        withEditing(model, (editing) => failCreateCompany(model, editing, failure)),
      ),
    ClickedSignOut: () => startSignOut(model),
    SucceededSignOut: ({ visit }) =>
      forThisVisit(model, visit, () =>
        withEditing(model, () => ({ model, outMessage: OutMessage.SignedOut() })),
      ),
    FailedSignOut: ({ visit }) =>
      forThisVisit(model, visit, () =>
        withEditing(model, (editing) => ({
          model: withPhase(
            model,
            modifyFields(editing, {
              signOut: () => Submission.Rejected({ message: SIGN_OUT_FAILED }),
            }),
          ),
        })),
      ),
  });

const maybeFailureMessageOf = (editing: Editing): Option.Option<string> =>
  Option.orElse(maybeRejectedMessage(editing.creation), () =>
    maybeRejectedMessage(editing.signOut),
  );

const companyFormView = (editing: Editing, h: HtmlBuilder<Message>): Html =>
  h.form(
    [
      h.Class("space-y-4"),
      h.AriaLabel("事業所登録フォーム"),
      h.OnSubmit(Message.SubmittedCompanyForm()),
    ],
    [
      inputView(
        {
          id: "company-name",
          label: "事業所名",
          type: "text",
          value: editing.name,
          onInput: (value) => Message.UpdatedName({ value }),
          submission: editing.creation,
          placeholder: "例: 株式会社サンプル / 山田太郎",
          maxLength: 100,
          hint: {
            text: "法人なら正式社名、個人事業主なら屋号 (なければご自身のお名前)",
            maybeErrorMessage: Option.none(),
          },
        },
        h,
      ),
      radioFieldsetView(
        {
          id: "org-code",
          legend: "事業形態",
          name: "org_code",
          options: ORG_CODE_OPTIONS,
          selected: editing.orgCode,
          onSelect: (orgCode) => Message.SelectedOrgCode({ orgCode }),
          isDisabled: Submission.guards.Submitting(editing.creation),
        },
        h,
      ),
      buttonView(
        {
          label: "事業所を作成",
          type: "submit",
          look: "primary",
          submission: editing.creation,
          isBlocked: String.isEmpty(String.trim(editing.name)),
        },
        h,
      ),
      ...Option.match(maybeFailureMessageOf(editing), {
        onNone: () => [],
        onSome: (failureMessage) => [
          h.p([h.Role("alert"), h.Class("text-sm text-destructive")], [failureMessage]),
        ],
      }),
    ],
  );

const editingView = (editing: Editing, h: HtmlBuilder<Message>): Html =>
  authPageCardView(
    {
      title: "事業所を登録してください",
      description: "taimei では事業所単位で課金 / メンバー管理を行います。",
      width: "md",
      content: [companyFormView(editing, h)],
      outside: [
        buttonView(
          {
            label: "別のアカウントでログインする",
            type: "button",
            look: "smallLink",
            submission: Submission.Idle(),
            isBlocked: false,
            onClick: Message.ClickedSignOut(),
          },
          h,
        ),
      ],
    },
    h,
  );

export const view = Submodel.defineView<Model, Message>((model, h) =>
  Phase.match(model.phase, {
    Checking: () => fullScreenStatusView("読み込み中…", h),
    Editing: (editing) => editingView(editing, h),
  }),
);
