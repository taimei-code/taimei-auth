import { expect, test } from "bun:test";
import { findAccountByUserId, type AccountRow } from "@/db/repositories/account";
import {
  deleteUser,
  findUserByEmail,
  findUserById,
  updateUser,
  type UserRow,
} from "@/db/repositories/user";

// 型レベル assert: repository 関数の戻り値が `Promise<T | undefined>` で揃うことを
// CI の `tsc --noEmit` で機械的に守る。型エラーが出れば PR は CI で reject される。
// 詳細: ~/.claude/plans/taimei/ADR-006-codebase-slim-down.md (D2)
type Assert<T extends true> = T;
type IsExact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type _t1 = Assert<IsExact<Awaited<ReturnType<typeof findUserById>>, UserRow | undefined>>;
type _t2 = Assert<IsExact<Awaited<ReturnType<typeof findUserByEmail>>, UserRow | undefined>>;
type _t3 = Assert<IsExact<Awaited<ReturnType<typeof updateUser>>, UserRow | undefined>>;
type _t4 = Assert<IsExact<Awaited<ReturnType<typeof deleteUser>>, UserRow | undefined>>;
type _t5 = Assert<IsExact<Awaited<ReturnType<typeof findAccountByUserId>>, AccountRow | undefined>>;

test("repository return types are Promise<T | undefined> (compile-time assertion)", () => {
  // 上記 type _t1-_t6 で型レベル assert 完結。tsc が通れば test 通過扱い。
  expect(true).toBe(true);
});
