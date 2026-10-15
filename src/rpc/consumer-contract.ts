import { Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSecurity,
} from "effect/http-api";
import { InvalidArgument } from "../membership/guard/errors";
import { ServiceKeyMisconfigured, ServiceKeyRejected } from "../service-key";

export class ServiceKeyAuth extends HttpApiMiddleware.Service<ServiceKeyAuth>()(
  "taimei/ConsumerServiceKeyAuth",
  {
    requiredForClient: true,
    security: { serviceKey: HttpApiSecurity.apiKey({ key: "X-Service-Key", in: "header" }) },
    error: [ServiceKeyRejected, ServiceKeyMisconfigured],
  },
) {}

const ConsumerRole = Schema.Literals(["OWNER", "ADMIN", "MEMBER"]);

export const VerifySessionResult = Schema.Union([
  Schema.TaggedStruct("Verified", {
    user: Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      email: Schema.String,
      emailVerified: Schema.Boolean,
      image: Schema.optional(Schema.String),
      createdAt: Schema.String,
      updatedAt: Schema.String,
      defaultCompanyId: Schema.optional(Schema.String),
    }),
    session: Schema.Struct({ id: Schema.String, expiresAt: Schema.String }),
    currentRole: Schema.optional(ConsumerRole),
  }),
  Schema.TaggedStruct("Rejected", {
    reason: Schema.Literals(["SESSION_NOT_FOUND", "USER_DELETED", "REVISION_OUTDATED"]),
  }),
]);

const BoundedId = Schema.String.check(Schema.isBetweenLength(1, 64));

export class ConsumerGroup extends HttpApiGroup.make("consumer")
  .add(
    HttpApiEndpoint.post("verifySession", "/rpc2/verify-session", {
      payload: Schema.Struct({ sessionToken: Schema.String }),
      success: VerifySessionResult,
    }),
    HttpApiEndpoint.post("checkMemberships", "/rpc2/check-memberships", {
      payload: Schema.Struct({
        companyId: BoundedId,
        userIds: Schema.Array(BoundedId).check(Schema.isMaxLength(1000)),
      }),
      success: Schema.Struct({
        companyActive: Schema.Boolean,
        memberUserIds: Schema.Array(Schema.String),
      }),
      error: InvalidArgument,
    }),
  )
  .middleware(ServiceKeyAuth) {}

export class ConsumerApi extends HttpApi.make("consumer").add(ConsumerGroup) {}
