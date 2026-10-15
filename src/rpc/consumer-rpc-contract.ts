import { Schema } from "effect";

export const CookieHeader = Schema.String.check(Schema.isMaxLength(8192));

const Role = Schema.Literals(["OWNER", "ADMIN", "MEMBER"]);

const User = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  emailVerified: Schema.Boolean,
  image: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

const SessionInfo = Schema.Struct({ id: Schema.String, expiresAt: Schema.String });

const Member = Schema.Struct({
  userId: Schema.String,
  name: Schema.String,
  email: Schema.String,
  role: Role,
});

export const Rejected = Schema.TaggedStruct("Rejected", {
  reason: Schema.Literals(["SESSION_NOT_FOUND", "USER_DELETED", "REVISION_OUTDATED"]),
});

export const InvalidInput = Schema.TaggedStruct("InvalidInput", {});

export const VerifySessionResult = Schema.Union([
  Schema.TaggedStruct("Verified", {
    user: User,
    session: SessionInfo,
    companyId: Schema.NullOr(Schema.String),
    role: Schema.NullOr(Role),
  }),
  Rejected,
  InvalidInput,
]);

export const ListMembersResult = Schema.Union([
  Schema.TaggedStruct("Listed", {
    companyId: Schema.NullOr(Schema.String),
    members: Schema.Array(Member),
  }),
  Rejected,
  InvalidInput,
]);

export const GetSessionResult = Schema.Union([
  Schema.TaggedStruct("Verified", {
    user: User,
    session: SessionInfo,
    companyId: Schema.NullOr(Schema.String),
    role: Schema.NullOr(Role),
    members: Schema.Array(Member),
  }),
  Rejected,
  InvalidInput,
]);

export interface ConsumerRpcContract {
  verifySession(cookieHeader: string): Promise<typeof VerifySessionResult.Encoded>;
  listCurrentCompanyMembers(cookieHeader: string): Promise<typeof ListMembersResult.Encoded>;
  getSession(cookieHeader: string): Promise<typeof GetSessionResult.Encoded>;
}
