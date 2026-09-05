import { Context } from "effect";
import type * as repo from "@/db/repositories/audit-log";
import type { LiftedModule } from "../errors";

// audit log の ports (ADR-0017 Decision の境界表 1 行目と依存注入項。型導出の規則は src/CLAUDE.md の Effect様式)。
// 横断関心のため domain dir でなく src/audit に置く。
export class AuditLog extends Context.Service<AuditLog, LiftedModule<typeof repo>>()(
  "taimei/AuditLog",
) {}
