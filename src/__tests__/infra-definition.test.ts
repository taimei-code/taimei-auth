import { expect, test } from "bun:test";

test("IaC の定義は、alchemy の CLI と同じく import できる (optional と書かれた peer が欠けると、deploy の時まで気づかない)", async () => {
  const definition = await import("../../infra/alchemy.run");
  expect(definition.default).toBeDefined();
});
