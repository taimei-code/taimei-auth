import { Schema } from "effect";

export const Id = Schema.String.check(Schema.isBetweenLength(1, 64));
export const Ok = Schema.Struct({ ok: Schema.Literal(true) });
export const AccountDeleted = Schema.Struct({ ...Ok.fields, account_deleted: Schema.Boolean });
export const SignedIn = Schema.Struct({
  redirect_url: Schema.String.check(Schema.isMinLength(1)),
});
export const CompanyParams = { companyId: Schema.String };
