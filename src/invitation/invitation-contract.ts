import { Schema, SchemaTransformation } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { z } from "zod";
import { Authenticated } from "../account/actor-contract";
import { EmailMismatch, ExpiredOrUsed, Forbidden, NotFound } from "../membership/guard/errors";
import { CompanyParams, Ok, RoleSchema } from "../membership/membership-contract";
import { TAIMEI_SERVICES, type ServiceName } from "../services";
import type { RedirectTarget as SignInRedirectTarget } from "../sign-in-params";
import { validateRedirectUrl } from "../url-allowlist";
import { NotFoundOrNotPending, RateLimited } from "./errors";

const PendingInvitation = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  role: RoleSchema,
  expires_at: Schema.String,
  created_at: Schema.String,
});

const RedirectTarget = Schema.Struct({
  service_name: Schema.Literals(Object.keys(TAIMEI_SERVICES) as [ServiceName, ...ServiceName[]]),
  redirect_url: Schema.String.check(Schema.isBetweenLength(1, 2048)),
}).check(
  Schema.makeFilter((t) => validateRedirectUrl(t.redirect_url, t.service_name), {
    expected: "redirect_url in allowlist",
  }),
);
const _redirectTargetMatchesSignInParams: [
  typeof RedirectTarget.Type,
  SignInRedirectTarget,
] extends [SignInRedirectTarget, typeof RedirectTarget.Type]
  ? true
  : never = true;

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
        email: Schema.String.check(Schema.isMaxLength(320), Schema.isPattern(z.regexes.email)).pipe(
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
        invitation_token: Schema.String.check(Schema.isBetweenLength(1, 256)),
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
