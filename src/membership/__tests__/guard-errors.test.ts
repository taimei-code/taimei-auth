import { describe, expect, test } from "bun:test";
import { InvalidArgument } from "../guard/errors";

describe("guard errors", () => {
  test("InvalidArgument は details 未指定なら own property を持たず、指定時は同一 object を持つ", () => {
    const without = new InvalidArgument({});
    expect(Object.hasOwn(without, "details") && without.details !== undefined).toBe(false);
    const details = { formErrors: [], fieldErrors: { email: ["x"] } };
    const withDetails = new InvalidArgument({ details });
    expect(withDetails.details).toBe(details);
  });
});
