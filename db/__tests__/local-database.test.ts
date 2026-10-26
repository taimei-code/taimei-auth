import { describe, expect, test } from "bun:test";
import { databaseTarget, requireLocalDatabase } from "../testing/local-database";
import { prepareNonProductionTables } from "../testing/non-production-tables";
import { postgresTtlStore } from "../testing/ttl-store";

describe("DATABASE_URL の向き先", () => {
  test.each([undefined, ""])("未設定 (%p) は Unset", (url) => {
    expect(databaseTarget(url)).toEqual({ _tag: "Unset" });
  });

  test.each([
    "localhost",
    "127.0.0.1",
    "[::1]",
    "auth-postgres",
    "taimei-auth-postgres",
  ])("host が %s なら Local", (hostname) => {
    expect(databaseTarget(`postgres://u:p@${hostname}:5432/auth`)).toEqual({
      _tag: "Local",
      hostname,
    });
  });

  test("local でない host は Remote", () => {
    expect(databaseTarget("postgres://u:p@db.example.com:5432/auth")).toEqual({
      _tag: "Remote",
      hostname: "db.example.com",
    });
  });

  test("host は大文字と小文字を区別しない", () => {
    expect(databaseTarget("postgres://u:p@LOCALHOST:5432/auth")).toEqual({
      _tag: "Local",
      hostname: "localhost",
    });
  });

  test("pg は query の host を URL の host より優先するので、query の host で判定する", () => {
    expect(databaseTarget("postgres://u:p@localhost:5432/auth?host=db.example.com")).toEqual({
      _tag: "Remote",
      hostname: "db.example.com",
    });
    expect(databaseTarget("postgres://u:p@db.example.com:5432/auth?host=localhost")).toEqual({
      _tag: "Local",
      hostname: "localhost",
    });
  });

  test("query の host が空なら URL の host で判定する", () => {
    expect(databaseTarget("postgres://u:p@db.example.com:5432/auth?host=")).toEqual({
      _tag: "Remote",
      hostname: "db.example.com",
    });
  });

  test("URL として読めない値は host の無い Remote", () => {
    expect(databaseTarget("not a url")).toEqual({ _tag: "Remote", hostname: null });
  });
});

describe("本番以外の DB への書き込みは、local と確かめた値を受け取ってからにする", () => {
  test.each([
    "localhost",
    "auth-postgres",
    "taimei-auth-postgres",
  ])("host が %s の URL は受ける", (hostname) => {
    expect(requireLocalDatabase(`postgres://u@${hostname}:5432/auth`)).toEqual({
      _tag: "Local",
      hostname,
    });
  });

  test("local でない host は、host を message に含めて throw する", () => {
    expect(() => requireLocalDatabase("postgres://u@db.example.com:5432/auth")).toThrow(
      "db.example.com",
    );
  });

  test("未設定は throw する", () => {
    expect(() => requireLocalDatabase(undefined)).toThrow();
  });

  test("確かめた値なしでは、本番以外の表の準備と TTL store を呼べない (typecheck が固定する)", () => {
    const callWithoutCheck = () => [
      // @ts-expect-error
      prepareNonProductionTables(),
      // @ts-expect-error
      postgresTtlStore(),
    ];
    expect(callWithoutCheck).toBeFunction();
  });
});
