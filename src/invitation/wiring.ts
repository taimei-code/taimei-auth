import { Layer } from "effect";
import * as repo from "@/db/repositories/invitation";
import { liftDb } from "../errors";
import { InvitationRepo } from "./ports";

// production 結線 (module ロード時 bind の根拠は src/membership/wiring.ts と同じ: db/CLAUDE.md の workerd gotcha)。
export const InvitationRepoLive = Layer.succeed(
  InvitationRepo,
  InvitationRepo.of({
    findByToken: liftDb(repo.findInvitationByToken),
    findActivePending: liftDb(repo.findActivePendingInvitation),
    listPending: liftDb(repo.listPendingInvitations),
    insert: liftDb(repo.insertInvitation),
    markAccepted: liftDb(repo.markInvitationAccepted),
    markRevoked: liftDb(repo.markInvitationRevoked),
    revokePendingOfCompany: liftDb(repo.revokePendingInvitationsOfCompany),
  }),
);
