import { afterAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { auditRowsFor, dbTest } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { normalizeResponse } from "../../handlers/__tests__/helpers";
import { handleRpc } from "../fetch-handler";

// Connect transport を test から立てる唯一の点。program を分離せず、
// production の handleRpc に Connect の JSON request を渡し、path 解決 → proto decode → runRpc の写像 →
// error JSON までを wire (status / content-type / body の 3 点) で固定する。requireServiceKey は src/app.ts の
// 前段 middleware なので対象外。

const { run, cleanup } = dbTest("rpc-del-");

const callDeleteUser = (userId: string) =>
  Effect.promise(async () => {
    const res = await handleRpc(
      new Request("http://localhost/rpc/auth.v1.UserService/DeleteUser", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId }),
      }),
    );
    if (!res) throw new Error("handleRpc returned null for a known method");
    return normalizeResponse(res);
  });

describe("UserService/DeleteUser via handleRpc", () => {
  afterAll(cleanup);

  test("ACTIVE 事業所の唯一 OWNER は failed_precondition (400) で user は残る", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("sole-owner");
        const companyId = yield* db.seedCompany("sole");
        yield* db.seedMembership(owner.id, companyId, "OWNER");

        expect(yield* callDeleteUser(owner.id)).toEqual({
          status: 400,
          contentType: "application/json",
          body: {
            code: "failed_precondition",
            message: "cannot delete user: sole OWNER of 1 active company(ies)",
          },
        });
        expect(yield* db.readUser(owner.id)).toBeDefined();
      }),
    ));

  test("所属 0 件の user は削除され account_delete を記帳する", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("orphan");

        expect(yield* callDeleteUser(user.id)).toEqual({
          status: 200,
          contentType: "application/json",
          body: { success: true },
        });
        expect(yield* db.readUser(user.id)).toBeUndefined();
        expect((yield* auditRowsFor(user.id, "account_delete")).length).toBe(1);
      }),
    ));
});
