import { Context } from "effect";
import type * as repo from "@/db/repositories/invitation";
import type { Lifted } from "../errors";

// invitation domain の ports (ADR-0017 Decision の境界表 1 行目と依存注入項)。
export class InvitationRepo extends Context.Service<
  InvitationRepo,
  {
    findByToken: Lifted<typeof repo.findInvitationByToken>;
    findActivePending: Lifted<typeof repo.findActivePendingInvitation>;
    listPending: Lifted<typeof repo.listPendingInvitations>;
    insert: Lifted<typeof repo.insertInvitation>;
    markAccepted: Lifted<typeof repo.markInvitationAccepted>;
    markRevoked: Lifted<typeof repo.markInvitationRevoked>;
    revokePendingOfCompany: Lifted<typeof repo.revokePendingInvitationsOfCompany>;
  }
>()("taimei/InvitationRepo") {}
