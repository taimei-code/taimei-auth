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

export const DevHomeProps = Schema.TaggedStruct("DevHome", {
  devAccounts: Schema.Array(Account),
  browserAccounts: Schema.Array(Account),
  viewer: Viewer,
  destination: Destination,
  signInAction: Schema.String,
  signOutAction: Schema.String,
  featureFlagsHref: Schema.NullOr(Schema.String),
});

export type DevHomeProps = typeof DevHomeProps.Type;

const FlagStatus = Schema.Literals(["On", "Off", "OnlyFor"]);

export type FlagStatus = typeof FlagStatus.Type;

const FlagOnPage = Schema.Struct({
  name: Schema.String,
  audience: Schema.Literals(["everyone", "companies"]),
  status: FlagStatus,
  companies: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.NullOr(Schema.String) })),
});

export const FlagNotice = Schema.Union([
  Schema.TaggedStruct("Switched", {
    flag: Schema.String,
    state: Schema.Literals(["on", "off", "onlyFor"]),
  }),
  Schema.TaggedStruct("NoCompanyIds", {}),
  Schema.TaggedStruct("UnknownCompanyIds", { ids: Schema.Array(Schema.String) }),
]);

export type FlagNotice = typeof FlagNotice.Type;

export const FeatureFlagsProps = Schema.TaggedStruct("FeatureFlags", {
  homeHref: Schema.String,
  switchAction: Schema.String,
  notice: Schema.NullOr(FlagNotice),
  flags: Schema.Array(FlagOnPage),
});

export type FeatureFlagsProps = typeof FeatureFlagsProps.Type;

const PageProps = Schema.Union([DevHomeProps, FeatureFlagsProps]);

export type PageProps = typeof PageProps.Type;

export const PagePropsFromJson = Schema.fromJsonString(PageProps);

export const PAGE_TITLES: Record<PageProps["_tag"], string> = {
  DevHome: "開発者ホーム",
  FeatureFlags: "フィーチャーフラグ",
};
