import { Array, Effect, Option, Schema, String } from "effect";
import { Command, File, Submodel, Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { defineTaggedUnion } from "foldkit/schema";
import { modifyFields } from "foldkit/struct";

import { AccountGroup } from "@core/account/account-contract";
import { orgCodeLabelJa } from "@core/company/org-code";
import { roleLabelJa } from "@core/membership/role-label";

import { readSession, signInClient } from "../../auth/sign-in-client";
import type { SpaHttpClient } from "../../shared/spa-http-client";
import { maybeRejectedMessage, Submission } from "../../shared/submission";
import { avatarClassNames } from "../../shared/ui/class-names";
import { maybeAlertTextView } from "../../shared/ui/alert-text-view";
import { buttonView } from "../../shared/ui/button-view";
import { fileInputView } from "../../shared/ui/file-input-view";
import { inputView } from "../../shared/ui/input-view";
import { NoticeTone } from "../../shared/ui/toast-view";
import * as AccountDeletion from "../account-deletion";
import * as CurrentCompany from "../current-company";
import { accountPageHeaderView, separatorView } from "../account-page-header-view";

const SignedInUser = Schema.Struct({
  name: Schema.String,
  email: Schema.String,
  maybeImageUrl: Schema.Option(Schema.String),
});

const Profile = defineTaggedUnion({
  Loading: {},
  Absent: {},
  Present: {
    loadedName: Schema.String,
    nameDraft: Schema.String,
    email: Schema.String,
    maybeImageUrl: Schema.Option(Schema.String),
    save: Submission,
    avatar: Submission,
  },
});
type Profile = typeof Profile.Type;
type Present = typeof Profile.Present.Type;

export const Model = Schema.Struct({
  visit: Schema.Int,
  profile: Profile,
  deletion: AccountDeletion.Model,
});
export type Model = typeof Model.Type;

export const Message = defineMessageUnion({
  SucceededLoadSession: { visit: Schema.Int, maybeUser: Schema.Option(SignedInUser) },
  FailedLoadSession: { visit: Schema.Int },
  UpdatedName: { value: Schema.String },
  SubmittedProfileForm: {},
  SucceededSaveProfile: { visit: Schema.Int },
  FailedSaveProfile: { visit: Schema.Int, message: Schema.String },
  SelectedAvatarFiles: { files: Schema.Array(File.File) },
  SucceededUploadAvatar: { visit: Schema.Int, imageUrl: Schema.String },
  FailedUploadAvatar: {
    visit: Schema.Int,
    maybeImageUrl: Schema.Option(Schema.String),
    message: Schema.String,
  },
  GotAccountDeletionMessage: { message: AccountDeletion.Message },
});
export type Message = typeof Message.Type;

export const OutMessage = defineMessageUnion({
  Notified: { tone: NoticeTone, text: Schema.String },
  RequiredSignIn: {},
});
export type OutMessage = typeof OutMessage.Type;

const SAVE_FAILED = "保存に失敗しました。";

const AVATAR_ACCEPT = "image/png,image/jpeg,image/webp";

export const AVATAR_UPLOAD_TOKEN_PATH = AccountGroup.endpoints.avatarUploadToken.path;

export const LoadSession = Command.define("LoadSession", {
  args: { visit: Schema.Int },
  messages: [Message.SucceededLoadSession, Message.FailedLoadSession],
  execute: ({ visit }) =>
    readSession.pipe(
      Effect.map(({ data }) =>
        Message.SucceededLoadSession({
          visit,
          maybeUser: Option.map(Option.fromNullishOr(data?.user), (user) => ({
            name: user.name,
            email: user.email,
            maybeImageUrl: Option.fromNullishOr(user.image).pipe(Option.filter(String.isNonEmpty)),
          })),
        }),
      ),
      Effect.catchTag("UnknownError", () => Effect.succeed(Message.FailedLoadSession({ visit }))),
    ),
});

export const SaveProfile = Command.define("SaveProfile", {
  args: { visit: Schema.Int, name: Schema.String },
  messages: [Message.SucceededSaveProfile, Message.FailedSaveProfile],
  execute: ({ visit, name }) =>
    Effect.tryPromise(() => signInClient.updateUser({ name })).pipe(
      Effect.map(({ error }) =>
        error === null
          ? Message.SucceededSaveProfile({ visit })
          : Message.FailedSaveProfile({ visit, message: error.message ?? SAVE_FAILED }),
      ),
      Effect.catchTag("UnknownError", () =>
        Effect.succeed(Message.FailedSaveProfile({ visit, message: SAVE_FAILED })),
      ),
    ),
});

const UPLOAD_FAILED = "アップロードに失敗しました";

const messageOfUnknown = (cause: unknown): string =>
  cause instanceof Error ? cause.message : UPLOAD_FAILED;

export const UploadAvatar = Command.define("UploadAvatar", {
  args: { visit: Schema.Int, file: File.File },
  messages: [Message.SucceededUploadAvatar, Message.FailedUploadAvatar],
  execute: ({ visit, file }) =>
    Effect.gen(function* () {
      const blob = yield* Effect.tryPromise({
        try: () =>
          import("@vercel/blob/client").then(({ upload }) =>
            upload(file.name, file, {
              access: "public",
              handleUploadUrl: AVATAR_UPLOAD_TOKEN_PATH,
            }),
          ),
        catch: (cause) =>
          Message.FailedUploadAvatar({
            visit,
            maybeImageUrl: Option.none(),
            message: messageOfUnknown(cause),
          }),
      });
      const maybeImageUrl = Option.some(blob.url);
      const saved = yield* Effect.tryPromise({
        try: () => signInClient.updateUser({ image: blob.url }),
        catch: (cause) =>
          Message.FailedUploadAvatar({ visit, maybeImageUrl, message: messageOfUnknown(cause) }),
      });
      return saved.error === null
        ? Message.SucceededUploadAvatar({ visit, imageUrl: blob.url })
        : Message.FailedUploadAvatar({
            visit,
            maybeImageUrl,
            message: saved.error.message ?? "画像の保存に失敗しました",
          });
    }).pipe(Effect.catch(Effect.succeed)),
});

type ViewInputs = Readonly<{ currentCompany: CurrentCompany.Model }>;

export const init = (visit: number): Update.Return<Model, Message, SpaHttpClient> => ({
  model: {
    visit,
    profile: Profile.Loading(),
    deletion: AccountDeletion.init(visit),
  },
  commands: [LoadSession({ visit })],
});

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, SpaHttpClient>;

const withPresent = (model: Model, next: (present: Present) => UpdateReturn): UpdateReturn =>
  Profile.matchOrElse(model.profile, { Present: next }, () => ({ model }));

const withProfile = (model: Model, present: Present): Model =>
  modifyFields(model, { profile: () => Profile.Present(present) });

const forThisVisit = (model: Model, visit: number, next: () => UpdateReturn): UpdateReturn =>
  visit === model.visit ? next() : { model };

const loadedProfile = (maybeUser: Option.Option<typeof SignedInUser.Type>): Profile =>
  Option.match(maybeUser, {
    onNone: () => Profile.Absent(),
    onSome: ({ name, email, maybeImageUrl }) =>
      Profile.Present({
        loadedName: name,
        nameDraft: name,
        email,
        maybeImageUrl,
        save: Submission.Idle(),
        avatar: Submission.Idle(),
      }),
  });

const submitProfileForm = (model: Model): UpdateReturn =>
  withPresent(model, (present) =>
    Submission.guards.Submitting(present.save)
      ? { model }
      : {
          model: withProfile(model, modifyFields(present, { save: () => Submission.Submitting() })),
          commands: [SaveProfile({ visit: model.visit, name: present.nameDraft })],
        },
  );

const finishSave = (model: Model, visit: number, tone: typeof NoticeTone.Type, text: string) =>
  forThisVisit(model, visit, () =>
    withPresent(model, (present) =>
      Submission.guards.Submitting(present.save)
        ? {
            model: withProfile(
              model,
              modifyFields(present, {
                save: () => Submission.Idle(),
                loadedName: (current) => (tone === "Success" ? present.nameDraft : current),
              }),
            ),
            outMessage: OutMessage.Notified({ tone, text }),
          }
        : { model },
    ),
  );

const selectAvatarFiles = (model: Model, files: ReadonlyArray<File.File>): UpdateReturn =>
  withPresent(model, (present) =>
    Option.match(Array.head(files), {
      onNone: () => ({ model }),
      onSome: (file) =>
        Submission.guards.Submitting(present.avatar)
          ? { model }
          : {
              model: withProfile(
                model,
                modifyFields(present, { avatar: () => Submission.Submitting() }),
              ),
              commands: [UploadAvatar({ visit: model.visit, file })],
            },
    }),
  );

const finishUpload = (
  model: Model,
  visit: number,
  maybeImageUrl: Option.Option<string>,
  avatar: Submission,
): UpdateReturn =>
  forThisVisit(model, visit, () =>
    withPresent(model, (present) =>
      Submission.guards.Submitting(present.avatar)
        ? {
            model: withProfile(
              model,
              modifyFields(present, {
                maybeImageUrl: (current) => Option.orElse(maybeImageUrl, () => current),
                avatar: () => avatar,
              }),
            ),
          }
        : { model },
    ),
  );

const foldAccountDeletionOutMessage = AccountDeletion.OutMessage.match<
  Update.StepWithOutMessage<Model, Message, OutMessage>
>({
  RequiredSignIn: () => (model) => ({ model, outMessage: OutMessage.RequiredSignIn() }),
});

const foldAccountDeletion = Update.foldChild({
  update: AccountDeletion.update,
  read: (model: Model) => Option.some(model.deletion),
  write: (model: Model, nextDeletion: AccountDeletion.Model) =>
    modifyFields(model, { deletion: () => nextDeletion }),
  toParentMessage: (message) => Message.GotAccountDeletionMessage({ message }),
  foldOutMessage: foldAccountDeletionOutMessage,
});

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    SucceededLoadSession: ({ visit, maybeUser }) =>
      forThisVisit(model, visit, () =>
        Profile.guards.Loading(model.profile)
          ? { model: modifyFields(model, { profile: () => loadedProfile(maybeUser) }) }
          : { model },
      ),
    FailedLoadSession: ({ visit }) =>
      forThisVisit(model, visit, () =>
        Profile.guards.Loading(model.profile)
          ? { model: modifyFields(model, { profile: () => Profile.Absent() }) }
          : { model },
      ),
    UpdatedName: ({ value }) =>
      withPresent(model, (present) =>
        Submission.guards.Submitting(present.save)
          ? { model }
          : { model: withProfile(model, modifyFields(present, { nameDraft: () => value })) },
      ),
    SubmittedProfileForm: () => submitProfileForm(model),
    SucceededSaveProfile: ({ visit }) => finishSave(model, visit, "Success", "保存しました。"),
    FailedSaveProfile: ({ visit, message: failureMessage }) =>
      finishSave(model, visit, "Error", failureMessage),
    SelectedAvatarFiles: ({ files }) => selectAvatarFiles(model, files),
    SucceededUploadAvatar: ({ visit, imageUrl }) =>
      finishUpload(model, visit, Option.some(imageUrl), Submission.Idle()),
    FailedUploadAvatar: ({ visit, maybeImageUrl, message: failureMessage }) =>
      finishUpload(model, visit, maybeImageUrl, Submission.Rejected({ message: failureMessage })),
    GotAccountDeletionMessage: ({ message: deletionMessage }) =>
      foldAccountDeletion(model, deletionMessage),
  });

const currentCompanyView = (company: CurrentCompany.Membership, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class("mb-8 rounded-md border border-border bg-muted/40 p-4 text-sm")],
    [
      h.p([h.Class("font-medium text-foreground")], ["現在の事業所"]),
      h.p(
        [h.Class("mt-1 text-muted-foreground")],
        [
          `${company.companyName} (${roleLabelJa(company.role)})`,
          h.span([h.Class("ml-2 text-xs")], [orgCodeLabelJa(company.orgCode)]),
        ],
      ),
    ],
  );

const profileFormView = (present: Present, h: HtmlBuilder<Message>): Html =>
  h.form(
    [h.Class("space-y-5"), h.OnSubmit(Message.SubmittedProfileForm())],
    [
      inputView(
        {
          id: "email",
          label: "メールアドレス",
          type: "email",
          value: present.email,
          submission: Submission.Idle(),
          placeholder: "",
          autocomplete: "email",
          isDisabled: true,
        },
        h,
      ),
      inputView(
        {
          id: "name",
          label: "名前",
          type: "text",
          value: present.nameDraft,
          onInput: (value) => Message.UpdatedName({ value }),
          submission: present.save,
          placeholder: "",
          autocomplete: "name",
          hint: {
            text: "アプリケーション内で表示される名前です",
            maybeErrorMessage: Option.none(),
          },
        },
        h,
      ),
      buttonView(
        {
          label: "保存",
          submittingLabel: "保存中…",
          type: "submit",
          look: "primaryInline",
          submission: present.save,
          isBlocked: false,
        },
        h,
      ),
    ],
  );

const avatarView = (present: Present, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class("space-y-3")],
    [
      h.div([h.Class("text-sm font-medium")], ["プロフィール写真"]),
      h.span(
        [h.Class(`${avatarClassNames.root} size-32`)],
        [
          Option.match(present.maybeImageUrl, {
            onNone: () =>
              h.span(
                [h.Class(`${avatarClassNames.fallback} text-3xl`)],
                [present.loadedName.charAt(0).toUpperCase() || "?"],
              ),
            onSome: (imageUrl) =>
              h.img([h.Src(imageUrl), h.Alt(present.loadedName), h.Class(avatarClassNames.image)]),
          }),
        ],
      ),
      fileInputView(
        {
          id: "avatar-upload",
          label: "画像を変更",
          submittingLabel: "アップロード中…",
          accept: AVATAR_ACCEPT,
          describedBy: "avatar-help",
          submission: present.avatar,
          onSelect: (files) => Message.SelectedAvatarFiles({ files }),
        },
        h,
      ),
      h.p(
        [h.Id("avatar-help"), h.Class("text-xs text-muted-foreground")],
        ["PNG / JPEG / WebP, 5 MB まで"],
      ),
      ...maybeAlertTextView(maybeRejectedMessage(present.avatar), h),
    ],
  );

const presentView = (
  model: Model,
  currentCompany: CurrentCompany.Model,
  present: Present,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [],
    [
      ...accountPageHeaderView("プロフィール", "アカウント情報の表示と編集", h),
      ...Option.match(CurrentCompany.maybeCurrentMembership(currentCompany.state), {
        onNone: () => [],
        onSome: (company) => [currentCompanyView(company, h)],
      }),
      h.div(
        [h.Class("grid gap-10 md:grid-cols-[1fr_220px]")],
        [profileFormView(present, h), avatarView(present, h)],
      ),
      separatorView("my-10", h),
      h.submodel({
        slotId: "account-deletion",
        view: AccountDeletion.view,
        model: model.deletion,
        toParentMessage: (message) => Message.GotAccountDeletionMessage({ message }),
      }),
    ],
  );

export const view = Submodel.defineView<Model, Message, ViewInputs>(
  (model, { currentCompany }, h) =>
    Profile.matchOrElse(
      model.profile,
      { Present: (present) => presentView(model, currentCompany, present, h) },
      () => h.div([]),
    ),
);
