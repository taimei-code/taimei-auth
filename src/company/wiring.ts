import { Layer } from "effect";
import * as repo from "@/db/repositories/company";
import { liftDb } from "../errors";
import { CompanyRepo } from "./ports";

// production 結線 (module ロード時 bind の根拠は src/membership/wiring.ts と同じ: db/CLAUDE.md の workerd gotcha)。
export const CompanyRepoLive = Layer.succeed(
  CompanyRepo,
  CompanyRepo.of({
    findById: liftDb(repo.findCompanyById),
    insert: liftDb(repo.insertCompany),
    update: liftDb(repo.updateCompany),
    softDelete: liftDb(repo.softDeleteCompany),
  }),
);
