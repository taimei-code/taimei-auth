import { Layer } from "effect";
import * as repo from "@/db/repositories/health";
import { liftAll } from "../errors";
import { HealthRepo } from "./ports";

export const HealthRepoLive = Layer.succeed(HealthRepo, liftAll(repo));
