import { Schema } from "effect";
import { CompanyNameSchema } from "../src/company/company-contract";
import { getTrustedOrigins } from "../src/env";
import { RoleSchema } from "../src/membership/membership-contract";

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

export const SetCurrentCompanyRequest = Schema.Struct({
  userId: Schema.String,
  companyId: Schema.String,
});
