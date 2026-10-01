import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { getRuntime, initRuntime } from "../runtime";
import { testTtlStore } from "./test-ttl-store";

const RUNTIME_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../runtime.ts"),
  "utf8",
);

describe("getRuntime", () => {
  test("2 回呼ぶと同一 object を返す (memo)", () => {
    expect(getRuntime()).toBe(getRuntime());
  });

  test("boot 後に initRuntime を呼んでも最初の runtime を返す (テストが Bun の entry を import しても preload の結線が残る)", () => {
    const booted = getRuntime();
    expect(initRuntime(testTtlStore)).toBe(booted);
  });

  test("Effect を実行できる", async () => {
    expect(await getRuntime().runPromise(Effect.succeed(1))).toBe(1);
  });

  test("runtime.ts は db/client と ttl-store を値で import しない (Layer に I/O resource を持たせない)", () => {
    expect(RUNTIME_SRC).not.toMatch(
      /^import (?!type )[^;]*from "(@\/db\/client|\.\/ttl-store|pg)"/m,
    );
  });
});
