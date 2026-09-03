// PoC (案 E1): bun:test から Effect program を走らせる。DATABASE_URL (compose の auth-postgres) が必要。
import { describe, expect, test } from "bun:test";
import { program, reqStore, runtime } from "./program";

const run = (id: string) => reqStore.run(id, () => runtime.runPromise(program(id)));

describe("poc effect-e1 (Bun)", () => {
  test("ALS store は Effect の各構造を越えて保持される", async () => {
    const result = await run("test-A");
    expect(result.obs.filter((o) => !o.ok)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("並行 2 本で store が混線しない", async () => {
    const [a, b] = await Promise.all([run("test-A"), run("test-B")]);
    expect(a.obs.every((o) => o.ok)).toBe(true);
    expect(b.obs.every((o) => o.ok)).toBe(true);
  });
});
