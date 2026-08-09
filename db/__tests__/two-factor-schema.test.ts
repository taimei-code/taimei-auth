import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { createSeedHelpers } from "../../src/handlers/__tests__/helpers";
import {
  countTwoFactorRows,
  enableMfaFor,
  findTwoFactorRow,
} from "../../src/mfa/__tests__/helpers";
import { db } from "../client";
import { deleteUser } from "../repositories/user";
import { findUserById } from "../repositories/user";
import * as schema from "../schema";
import { twoFactor } from "../schema";

// two_factor テーブル定義の統合テスト。better-auth の drizzle adapter は schema["twoFactor"] で
// 引くため export 名まで契約に含まれ、列を 1 つ落とすとプラグインのロック機構が silent に死ぬか
// 毎回 500 になる。定義そのものを DB とコードの両側から突き合わせる。

const P = "mfa-schema-";
const { cleanup, seedUser } = createSeedHelpers(P);

describe("two_factor スキーマ", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("QA-M-02 全フィールド + export twoFactor", async () => {
    expect(schema.twoFactor).toBe(twoFactor);

    const table = getTableConfig(twoFactor);
    expect(table.name).toBe("two_factor");
    expect(new Set(table.columns.map((column) => column.name))).toEqual(
      new Set([
        "id",
        "secret",
        "backup_codes",
        "user_id",
        "verified",
        "failed_verification_count",
        "locked_until",
      ]),
    );

    const notNullColumns = table.columns
      .filter((column) => column.notNull)
      .map((column) => column.name);
    // locked_until だけが NULL 可 (ロック中でないことを NULL で表す)。
    expect(new Set(notNullColumns)).toEqual(
      new Set(["id", "secret", "backup_codes", "user_id", "verified", "failed_verification_count"]),
    );
  });

  test("QA-H-09 migration 直後 全 user false / 0 行", async () => {
    const columnDefaults = await db.execute<{ column_name: string; column_default: string | null }>(
      sql`select column_name, column_default from information_schema.columns
          where table_name = 'user' and column_name = 'two_factor_enabled'`,
    );
    // 既存 user が migration 直後に有効化済みに見えないことは、列の default が保証する。
    expect(columnDefaults.rows[0]?.column_default).toContain("false");

    const user = await seedUser("h09");
    expect((await findUserById(user.id))?.twoFactorEnabled).toBe(false);
    expect(await countTwoFactorRows(user.id)).toBe(0);
  });

  test("QA-M-03 backup_codes 非平文", async () => {
    const user = await seedUser("m03");
    const enabled = await enableMfaFor(user);
    const stored = (await findTwoFactorRow(user.id))?.backupCodes as string;

    // 平文 JSON のまま保存されると、DB dump が第二要素の完全なバイパス手段になる。
    for (const code of enabled.recoveryCodes) {
      expect(stored).not.toContain(code);
    }
    expect(() => JSON.parse(stored) as unknown).toThrow();
    expect(stored).not.toContain(enabled.secret);
  });

  test("QA-D-06 物理削除 cascade 孤児 0", async () => {
    const user = await seedUser("d06");
    await enableMfaFor(user);
    expect(await countTwoFactorRows(user.id)).toBe(1);

    // ADR-0010 の物理削除ライフサイクル。FK 違反で退会が 500 になっても、行が残って孤児に
    // なってもいけない。
    const deleted = await deleteUser(user.id);

    expect(deleted?.id).toBe(user.id);
    expect(await countTwoFactorRows(user.id)).toBe(0);
  });

  test("QA-M-24 cascade FK 違反なし", async () => {
    const user = await seedUser("m24");
    await enableMfaFor(user);
    await deleteUser(user.id);

    const orphans = await db.execute<{ count: string }>(
      sql`select count(*)::text as count from two_factor tf
          left join "user" u on u.id = tf.user_id
          where u.id is null`,
    );

    expect(orphans.rows[0]?.count).toBe("0");
  });
});
