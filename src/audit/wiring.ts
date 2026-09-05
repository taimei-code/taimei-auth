import { Layer } from "effect";
import * as repo from "@/db/repositories/audit-log";
import { liftAll } from "../errors";
import { AuditLog } from "./ports";

// production 結線 (module ロード時 bind の根拠は src/membership/wiring.ts と同じ: db/CLAUDE.md の workerd gotcha)。
export const AuditLogLive = Layer.succeed(AuditLog, liftAll(repo));
