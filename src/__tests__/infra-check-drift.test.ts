import { expect, test } from "bun:test";
import { differingOperationLines } from "../../infra/check-drift";

test("alchemy の plan と drift の出力のうち、noop と unchanged 以外の操作の行を差として報告する", () => {
  const output = [
    "Plan: 1 to update",
    "[Auth] update",
    "[Auth/KV_STORE] noop",
    "  [Secrets] unchanged",
    "[Auth/EXTRA] create",
  ].join("\n");

  expect(differingOperationLines(output)).toEqual(["[Auth] update", "[Auth/EXTRA] create"]);
});

test("noop と unchanged だけの出力では、差を報告しない", () => {
  expect(differingOperationLines("[Auth] noop\n[Secrets] unchanged\nno changes")).toEqual([]);
});

test("差が無い時の no changes の出力は、差を報告しない", () => {
  expect(differingOperationLines("Plan: no changes")).toEqual([]);
});

test("操作の行も no changes も無い出力は、alchemy の出力の形が変わったとみなして失敗する (黙って通さない)", () => {
  expect(() => differingOperationLines("Unexpected output format")).toThrow();
});

test("CI の非対話の出力で、行の前に付く Effect の log の時刻と level を外して操作を読む", () => {
  const output = [
    "[12:00:00.123] INFO (#1): Plan: 1 to update",
    "[12:00:00.124] INFO (#1): [Auth] update (renamed from Worker)",
    "[12:00:00.125] INFO (#1): [Auth/KV_STORE] noop",
    "[12:00:00.126] INFO (#1): [Hyperdrive] noop (remote)",
  ].join("\n");

  expect(differingOperationLines(output)).toEqual(["[Auth] update"]);
});
