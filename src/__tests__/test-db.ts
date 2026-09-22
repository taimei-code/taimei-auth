import { Context, Layer } from "effect";
import * as read from "@/db/testing/read";
import { createSeed, ids } from "@/db/testing/seed";
import { type LiftedModule, liftAll } from "../errors";

// テスト用の port。db/ が所有する Promise ベースの db/testing/* を包む Effect face で、production の ports と wiring と同じ idiom
// (Promise の module を liftAll で Context.Service にする) に従う。理由は ADR-0017 Decision の依存注入の項で定義する。
// 識別子の導出 (ids、同期関数) は liftAll の対象外なので、face にそのまま含める。テストが prefix を書き直さなくて済むようにするため。
export class TestDb extends Context.Service<
  TestDb,
  LiftedModule<ReturnType<typeof createSeed>> &
    LiftedModule<typeof read> & { readonly ids: ReturnType<typeof ids> }
>()("taimei/TestDb") {}

// prefix はファイル単位の定数なので、Layer にまとめる。
export const testDbLayer = (prefix: string): Layer.Layer<TestDb> =>
  Layer.succeed(TestDb, { ...liftAll(createSeed(prefix)), ...liftAll(read), ids: ids(prefix) });
