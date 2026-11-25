import { Effect, Schema } from "effect";
import type { RedirectTarget } from "../sign-in-params";

const IgnoredIfNotString = Schema.optional(
  Schema.UndefinedOr(Schema.String).pipe(Schema.catchDecoding(() => Effect.succeedSome(undefined))),
);

export const RedirectTargetSearch = Schema.Struct({
  service_name: IgnoredIfNotString,
  redirect_url: IgnoredIfNotString,
});

export type RedirectTargetSearch = typeof RedirectTargetSearch.Type;

export const AcceptInvitationSearch = Schema.Struct({
  ...RedirectTargetSearch.fields,
  invitation_token: IgnoredIfNotString,
});

const ACCEPT_INVITATION_ROUTE = "/signup/accept-invitation";
const ACCEPT_INVITATION_PATH = `/auth${ACCEPT_INVITATION_ROUTE}` as const;

export const acceptInvitationPath = (invitationToken: string, target?: RedirectTarget): string => {
  const search = {
    invitation_token: invitationToken,
    ...target,
  } satisfies typeof AcceptInvitationSearch.Encoded;
  return `${ACCEPT_INVITATION_PATH}?${new URLSearchParams(search)}`;
};
