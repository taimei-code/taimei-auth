import { Context } from "effect";
import type * as repo from "@/db/repositories/company";
import type { Lifted } from "../errors";

// company domain の ports (ADR-0017 Decision の境界表 1 行目と依存注入項)。
export class CompanyRepo extends Context.Service<
  CompanyRepo,
  {
    findById: Lifted<typeof repo.findCompanyById>;
    insert: Lifted<typeof repo.insertCompany>;
    update: Lifted<typeof repo.updateCompany>;
    softDelete: Lifted<typeof repo.softDeleteCompany>;
  }
>()("taimei/CompanyRepo") {}
