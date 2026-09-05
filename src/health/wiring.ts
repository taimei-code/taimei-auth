import { Layer } from "effect";
import * as repo from "@/db/repositories/health";
import { liftDb } from "../errors";
import { HealthRepo } from "./ports";

export const HealthRepoLive = Layer.succeed(
  HealthRepo,
  HealthRepo.of({ pingDatabase: liftDb(repo.pingDatabase) }),
);
