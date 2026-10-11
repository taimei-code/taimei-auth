import { HttpApi } from "effect/http-api";
import { AccountGroup } from "./account/account-contract";
import { CompanyGroup } from "./company/company-contract";
import { InvitationGroup } from "./invitation/invitation-contract";
import { MembershipGroup } from "./membership/membership-contract";
import { MfaChallengeGroup, MfaGroup } from "./mfa/mfa-contract";

export class SpaApi extends HttpApi.make("spa")
  .add(AccountGroup)
  .add(MembershipGroup)
  .add(CompanyGroup)
  .add(InvitationGroup)
  .add(MfaGroup)
  .add(MfaChallengeGroup) {}
