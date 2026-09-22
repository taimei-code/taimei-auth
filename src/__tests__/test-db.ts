import { Context, Layer } from "effect";
import * as read from "@/db/testing/read";
import { createSeed, ids } from "@/db/testing/seed";
import { type LiftedModule, liftAll } from "../errors";

export class TestDb extends Context.Service<
  TestDb,
  LiftedModule<ReturnType<typeof createSeed>> &
    LiftedModule<typeof read> & { readonly ids: ReturnType<typeof ids> }
>()("taimei/TestDb") {}

export const testDbLayer = (prefix: string): Layer.Layer<TestDb> =>
  Layer.succeed(TestDb, { ...liftAll(createSeed(prefix)), ...liftAll(read), ids: ids(prefix) });
