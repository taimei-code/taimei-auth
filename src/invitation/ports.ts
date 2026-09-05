import { Context } from "effect";
import type * as repo from "@/db/repositories/invitation";
import type { LiftedModule } from "../errors";

// invitation domain の ports (ADR-0017 Decision の境界表 1 行目と依存注入項。型導出の規則は src/CLAUDE.md の Effect様式)。
export class InvitationRepo extends Context.Service<InvitationRepo, LiftedModule<typeof repo>>()(
  "taimei/InvitationRepo",
) {}
