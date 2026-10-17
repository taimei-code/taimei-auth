import { Schema } from "effect";

const Role = Schema.Literals(["OWNER", "ADMIN", "MEMBER"]);

export const SignedInUserRequest = Schema.Struct({
  name: Schema.optional(Schema.String),
  companies: Schema.Array(
    Schema.Struct({
      name: Schema.optional(Schema.String),
      role: Role,
    }),
  ),
  returnTo: Schema.String,
});

export const SetCurrentCompanyRequest = Schema.Struct({
  userId: Schema.String,
  companyId: Schema.String,
});
