import { describe, expect, test } from "bun:test";
import { requireAuthSecret } from "../auth-secret";

describe("AUTH_SECRET が空なら起動しない (better-auth は NODE_ENV が production でない時、公開の既定の secret で黙って署名する。Workers には NODE_ENV が無い)", () => {
  test.each([undefined, ""])("AUTH_SECRET が %p なら、名前を含めて throw する", (value) => {
    expect(() => requireAuthSecret(value)).toThrow("AUTH_SECRET");
  });

  test("AUTH_SECRET があれば、その値を返す", () => {
    expect(requireAuthSecret("a-secret")).toBe("a-secret");
  });
});
