import { Context, Layer } from "effect";
import * as read from "@/db/testing/read";
import { createSeed, ids } from "@/db/testing/seed";
import { type LiftedModule, liftAll } from "../errors";

// test 用の port: db/testing/* (Promise、db/ 所有) の Effect face。production の ports / wiring と同じ idiom
// (Promise module → liftAll → Context.Service)。理由の正本は ADR-0017 Decision の依存注入項。
// 識別子の導出 (ids、同期関数) は liftAll の対象外なので face にそのまま載せる。test が prefix を再記述しないため。
export class TestDb extends Context.Service<
  TestDb,
  LiftedModule<ReturnType<typeof createSeed>> &
    LiftedModule<typeof read> & { readonly ids: ReturnType<typeof ids> }
>()("taimei/TestDb") {}

// prefix は file 単位の定数なので Layer に束ねる。
export const testDbLayer = (prefix: string): Layer.Layer<TestDb> =>
  Layer.succeed(TestDb, { ...liftAll(createSeed(prefix)), ...liftAll(read), ids: ids(prefix) });
