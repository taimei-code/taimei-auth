import { Context } from "effect";
import type * as repo from "@/db/repositories/company";
import type { LiftedModule } from "../errors";

// company domain の ports (ADR-0017 Decision の境界表 1 行目と依存注入項。型導出の規則は src/CLAUDE.md の Effect様式)。
export class CompanyRepo extends Context.Service<CompanyRepo, LiftedModule<typeof repo>>()(
  "taimei/CompanyRepo",
) {}
