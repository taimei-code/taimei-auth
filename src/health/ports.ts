import { Context } from "effect";
import type * as repo from "@/db/repositories/health";
import type { Lifted } from "../errors";

// /health の DB ping (Redis ping と Effect.all で並列に打つ。ADR-0017 Decision の非同期項)。
export class HealthRepo extends Context.Service<
  HealthRepo,
  {
    pingDatabase: Lifted<typeof repo.pingDatabase>;
  }
>()("taimei/HealthRepo") {}
