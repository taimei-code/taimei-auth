import { expect, test } from "bun:test";
import { findAccountByUserId, type AccountRow } from "@/db/repositories/account";
import {
  deleteUser,
  findUserByEmail,
  findUserById,
  updateUser,
  type UserRow,
} from "@/db/repositories/user";

type Assert<T extends true> = T;
type IsExact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type _t1 = Assert<IsExact<Awaited<ReturnType<typeof findUserById>>, UserRow | undefined>>;
type _t2 = Assert<IsExact<Awaited<ReturnType<typeof findUserByEmail>>, UserRow | undefined>>;
type _t3 = Assert<IsExact<Awaited<ReturnType<typeof updateUser>>, UserRow | undefined>>;
type _t4 = Assert<IsExact<Awaited<ReturnType<typeof deleteUser>>, UserRow | undefined>>;
type _t5 = Assert<IsExact<Awaited<ReturnType<typeof findAccountByUserId>>, AccountRow | undefined>>;

test("repository return types are Promise<T | undefined> (compile-time assertion)", () => {
  expect(true).toBe(true);
});
