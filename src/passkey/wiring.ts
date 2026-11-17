import { Layer } from "effect";
import * as repo from "@/db/repositories/passkey";
import { liftAll } from "../errors";
import { PasskeyRepo } from "./ports";

export const PasskeyRepoLive = Layer.succeed(PasskeyRepo, liftAll(repo));
