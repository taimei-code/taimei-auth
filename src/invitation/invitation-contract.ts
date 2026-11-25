import { Schema, SchemaTransformation } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { Authenticated } from "../account/actor-contract";
import { EmailMismatch, ExpiredOrUsed } from "./errors";
import { Forbidden, NotFound, RateLimited } from "../failures";
import { RoleSchema } from "../membership/membership-contract";
import { CompanyParams, Ok } from "../spa-contract-schemas";
import { InvitationToken, RedirectTarget } from "../sign-in-params";
import { NotFoundOrNotPending } from "./errors";

const PendingInvitation = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  role: RoleSchema,
  expires_at: Schema.String,
  created_at: Schema.String,
});

const INVITABLE_EMAIL =
  /^(?:[A-Za-z0-9_'+-]+\.)*[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

export class InvitationGroup extends HttpApiGroup.make("invitation")
  .add(
    HttpApiEndpoint.get("pending", "/api/account/companies/:companyId/invitations", {
      params: CompanyParams,
      success: Schema.Struct({ invitations: Schema.Array(PendingInvitation) }),
      error: Forbidden,
    }),
    HttpApiEndpoint.post("create", "/api/account/companies/:companyId/invitations", {
      params: CompanyParams,
      payload: Schema.Struct({
        email: Schema.String.check(Schema.isMaxLength(320), Schema.isPattern(INVITABLE_EMAIL)).pipe(
          Schema.decode(SchemaTransformation.toLowerCase()),
        ),
        role: RoleSchema,
        redirect_target: Schema.optional(RedirectTarget),
      }),
      success: Schema.Struct({
        invitation: Schema.Struct({
          id: Schema.String,
          email: Schema.String,
          role: RoleSchema,
          expires_at: Schema.String,
        }),
        reused: Schema.Boolean,
      }),
      error: [Forbidden, RateLimited],
    }),
    HttpApiEndpoint.post(
      "revoke",
      "/api/account/companies/:companyId/invitations/:invitationId/revoke",
      {
        params: { ...CompanyParams, invitationId: Schema.String },
        success: Ok,
        error: [Forbidden, NotFoundOrNotPending],
      },
    ),
    HttpApiEndpoint.post("accept", "/api/account/accept-invitation", {
      payload: Schema.Struct({
        invitation_token: InvitationToken,
      }),
      success: Schema.Struct({
        ...Ok.fields,
        company_id: Schema.String,
        reused: Schema.optional(Schema.Literal(true)),
      }),
      error: [NotFound, EmailMismatch, ExpiredOrUsed],
    }),
  )
  .middleware(Authenticated) {}
