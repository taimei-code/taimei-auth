import { Schema } from "effect";
import { ROLES } from "../../db/enums";

export const PAGE_PROPS_ELEMENT_ID = "page-props";

const Company = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  role: Schema.Literals(ROLES),
  isCurrent: Schema.Boolean,
});

const Account = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  companies: Schema.Array(Company),
});

export type PageAccount = typeof Account.Type;

const Viewer = Schema.Union([
  Schema.TaggedStruct("SignedOut", { notice: Schema.Literals(["JustSignedOut", "None"]) }),
  Schema.TaggedStruct("SignedIn", {
    account: Account,
    notice: Schema.Literals(["JustSignedIn", "None"]),
  }),
]);

export type Viewer = typeof Viewer.Type;

const Destination = Schema.Union([
  Schema.TaggedStruct("AccountPage", {}),
  Schema.TaggedStruct("Application", { redirectUrl: Schema.String }),
]);

export type Destination = typeof Destination.Type;

const DevHomeProps = Schema.TaggedStruct("DevHome", {
  devAccounts: Schema.Array(Account),
  browserAccounts: Schema.Array(Account),
  viewer: Viewer,
  destination: Destination,
  signInAction: Schema.String,
  signOutAction: Schema.String,
});

export type DevHomeProps = typeof DevHomeProps.Type;

export type PageProps = DevHomeProps;

export const PagePropsFromJson = Schema.fromJsonString(DevHomeProps);

export const PAGE_TITLES: Record<PageProps["_tag"], string> = {
  DevHome: "開発者ホーム",
};
