import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../schema";

describe("MFA registration transition guard schema", () => {
  test("stores the guard protocol version in singleton metadata", () => {
    const protocolTable = (
      schema as unknown as {
        mfaRegistrationGuardProtocol?: Parameters<typeof getTableConfig>[0];
      }
    ).mfaRegistrationGuardProtocol;

    expect(protocolTable).toBeDefined();
    if (!protocolTable) return;

    const table = getTableConfig(protocolTable);
    expect(table.name).toBe("mfa_registration_guard_protocol");
    expect(table.columns.map((column) => column.name)).toEqual(["protocol_key", "version"]);
    expect(table.columns.find((column) => column.name === "protocol_key")?.primary).toBe(true);
  });

  test("QA-I-01 keeps one guarded transition per user and follows user deletion", () => {
    const table = getTableConfig(schema.mfaRegistrationTransitionGuard);

    expect(table.name).toBe("mfa_registration_transition_guard");
    expect(table.columns.find((column) => column.name === "user_id")?.primary).toBe(true);
    expect(table.foreignKeys).toHaveLength(1);
    expect(table.foreignKeys[0]?.onDelete).toBe("cascade");
  });

  test("QA-I-02 accepts only registration write operation kinds", () => {
    const table = getTableConfig(schema.mfaRegistrationTransitionGuard);
    const operationCheck = table.checks.find(
      (check) => check.name === "mfa_registration_guard_operation_kind_check",
    );

    expect(operationCheck).toBeDefined();
  });
});
