import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { getRuntime } from "../runtime";

const RUNTIME_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../runtime.ts"),
  "utf8",
);

// design §3.1 / AC-006 / AC-008: runtime は lazy accessor で isolate/process に 1 つ。Layer は I/O resource を
// 持たない (pool は ALS、Redis client は initRedis が持つ) ので、runtime.ts は db/client と redis を import しない。
describe("getRuntime", () => {
  test("2 回呼ぶと同一 object を返す (memo)", () => {
    expect(getRuntime()).toBe(getRuntime());
  });

  test("Effect を実行できる", async () => {
    expect(await getRuntime().runPromise(Effect.succeed(1))).toBe(1);
  });

  test("runtime.ts は db/client と redis を import しない (Layer に I/O resource を持たせない)", () => {
    expect(RUNTIME_SRC).not.toMatch(/from "@\/db\/client"|from "\.\/redis"|from "pg"/);
  });
});
