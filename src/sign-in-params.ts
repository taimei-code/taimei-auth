import { Schema } from "effect";
import { SERVICE_NAMES, type ServiceName } from "./services";
import { validateRedirectUrl } from "./url-allowlist";

const ServiceNameSchema = Schema.Literals(SERVICE_NAMES);
const BoundedUrl = Schema.String.check(Schema.isBetweenLength(1, 2048));
export const InvitationToken = Schema.String.check(Schema.isBetweenLength(1, 256));

const isRedirectUrlAllowed = (data: { service_name: ServiceName; redirect_url: string }) =>
  validateRedirectUrl(data.redirect_url, data.service_name);
const REDIRECT_URL_IN_ALLOWLIST = { expected: "redirect_url in allowlist" };
const redirectUrlInAllowlist = Schema.makeFilter(isRedirectUrlAllowed, REDIRECT_URL_IN_ALLOWLIST);

export const SignInParams = Schema.Struct({
  service_name: ServiceNameSchema,
  redirect_url: BoundedUrl,
  sign_up_url: Schema.optional(BoundedUrl),
  invitation_token: Schema.optional(InvitationToken),
}).check(
  redirectUrlInAllowlist,
  Schema.makeFilter(
    (data) =>
      data.sign_up_url === undefined || validateRedirectUrl(data.sign_up_url, data.service_name),
    { expected: "sign_up_url in allowlist" },
  ),
);

export const RedirectTarget = Schema.Struct({
  service_name: ServiceNameSchema,
  redirect_url: BoundedUrl,
}).check(redirectUrlInAllowlist);

export type RedirectTarget = typeof RedirectTarget.Type;

export const REAUTHENTICATION_SERVICE = "accounts" satisfies ServiceName;

export const ReauthenticationSearch = Schema.Struct({ redirect_url: BoundedUrl }).check(
  Schema.makeFilter(
    ({ redirect_url }) =>
      isRedirectUrlAllowed({ service_name: REAUTHENTICATION_SERVICE, redirect_url }),
    REDIRECT_URL_IN_ALLOWLIST,
  ),
);

export const INVALID_REDIRECT_URL_PAGE = "/auth/error?reason=invalid_redirect_url";
