// PoC の型 probe。各 @ts-expect-error の行が型エラーにならなければ tsc が TS2578 で落ちる
import { LastOwner } from "@core/membership/errors";
import { EmailMismatch } from "@core/membership/guard/errors";
import { Effect } from "effect";
import { type AsyncResult, type Atom, AtomRegistry } from "effect/reactivity";

import { changeRoleAtom } from "../membership/members-atom";
import { AccountApiClient } from "../shared/account-api-client";

// @ts-expect-error K1 endpoint 名の打ち間違い
AccountApiClient.query("members", "lsit", { params: { companyId: "x" } });
// @ts-expect-error K2 path param の型違い
AccountApiClient.query("members", "list", { params: { company: "x" } });

const registry = AtomRegistry.make();
registry.set(changeRoleAtom, {
  params: { companyId: "x", targetUserId: "u" },
  // @ts-expect-error K2 body の型違い
  payload: { role: "BOSS" },
});

type ChangeRoleError = AsyncResult.AsyncResult.Failure<Atom.Type<typeof changeRoleAtom>>;
declare const error: ChangeRoleError;
// @ts-expect-error K5 宣言にない失敗の名前を扱う
export const k5 = error._tag === "LastOwnerr";

// E2 宣言した失敗が Effect の E 型として届く
export const e2: ChangeRoleError = new LastOwner();
// @ts-expect-error E2 宣言していない失敗は E 型に入らない
export const e2n: ChangeRoleError = new EmailMismatch();
export const e2e = Effect.fail(error);
