import { Record, Schema } from "effect";
import { CompanyNameSchema } from "../src/company/company-contract";
import { getTrustedOrigins } from "../src/env";
import { RoleSchema } from "../src/membership/membership-contract";
import { FEATURE_FLAG_CATALOG } from "./feature-flag-catalog";

const TrustedReturnTo = Schema.String.check(
  Schema.makeFilter(
    (returnTo) => URL.canParse(returnTo) && getTrustedOrigins().includes(new URL(returnTo).origin),
    { expected: "a URL on a trusted origin" },
  ),
);

export const SignedInUserRequest = Schema.Struct({
  name: Schema.optional(CompanyNameSchema),
  companies: Schema.Array(
    Schema.Struct({
      name: Schema.optional(CompanyNameSchema),
      role: RoleSchema,
    }),
  ),
  returnTo: TrustedReturnTo,
});

export const LoginLinkRequest = Schema.Struct({
  email: Schema.String,
  returnTo: TrustedReturnTo,
});

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

export const SessionAgeRequest = Schema.Struct({
  issuedSecondsAgo: Schema.Int.check(
    Schema.isGreaterThan(0),
    Schema.isLessThanOrEqualTo(SECONDS_PER_YEAR),
  ),
});

const RegisteredFeatureFlag = Schema.Literals(Record.keys(FEATURE_FLAG_CATALOG));

export const FeatureFlagSwitchRequest = Schema.Union([
  Schema.Struct({ flag: RegisteredFeatureFlag, state: Schema.Literal("on") }),
  Schema.Struct({ flag: RegisteredFeatureFlag, state: Schema.Literal("off") }),
  Schema.Struct({
    flag: RegisteredFeatureFlag,
    state: Schema.Literal("onlyFor"),
    companyIds: Schema.Array(Schema.String),
  }),
]);

export const SetCurrentCompanyRequest = Schema.Struct({
  userId: Schema.String,
  companyId: Schema.String,
});
