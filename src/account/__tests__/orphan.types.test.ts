import { expect, test } from "bun:test";
import type { Effect } from "effect";
import type { DbTx } from "@/db/transaction";
import type { AppServices } from "../../runtime";
import { deleteAccountIfOrphaned } from "../orphan";

const _outsideTransaction = (tx: DbTx) => {
  // @ts-expect-error commit 後の後始末を登録するので、Transaction.run の外では AfterCommit が足りない
  const program: Effect.Effect<unknown, unknown, AppServices> = deleteAccountIfOrphaned(
    "u",
    tx,
    "sweep",
  );
  return program;
};

test("deleteAccountIfOrphaned は Transaction.run の中でしか実行できない (typecheck で検査する)", () => {
  expect(true).toBe(true);
});
