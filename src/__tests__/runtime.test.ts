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

describe("getRuntime", () => {
  test("2 回呼ぶと同一 object を返す (memo)", () => {
    expect(getRuntime()).toBe(getRuntime());
  });

  test("Effect を実行できる", async () => {
    expect(await getRuntime().runPromise(Effect.succeed(1))).toBe(1);
  });

  test("runtime.ts は db/client と ttl-store を import しない (Layer に I/O resource を持たせない)", () => {
    expect(RUNTIME_SRC).not.toMatch(/from "@\/db\/client"|from "\.\/ttl-store"|from "pg"/);
  });
});
