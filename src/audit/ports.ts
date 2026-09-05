import { Context } from "effect";
import type * as repo from "@/db/repositories/audit-log";
import type { LiftedModule } from "../errors";

// audit log の ports (ADR-0017 Decision の境界表 1 行目と依存注入項)。横断関心のため domain dir でなく src/audit に置く。
// method 名と引数・戻り値は db/repositories/audit-log の全 export から型導出する (appendAuditLog だけ append に短縮)。
export class AuditLog extends Context.Service<
  AuditLog,
  Omit<LiftedModule<typeof repo>, "appendAuditLog"> & {
    append: LiftedModule<typeof repo>["appendAuditLog"];
  }
>()("taimei/AuditLog") {}
