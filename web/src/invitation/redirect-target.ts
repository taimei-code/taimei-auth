import { Option, Schema } from "effect";

import type { RedirectTargetSearch } from "@core/invitation/accept-path";
import { RedirectTarget } from "@core/sign-in-params";

const decodeRedirectTarget = Schema.decodeUnknownOption(RedirectTarget);

export const parseRedirectTarget = (search: RedirectTargetSearch): RedirectTarget | undefined =>
  Option.getOrUndefined(decodeRedirectTarget(search));

export const redirectUrlAfterAccept = (search: RedirectTargetSearch): string =>
  parseRedirectTarget(search)?.redirect_url ?? "/account";
