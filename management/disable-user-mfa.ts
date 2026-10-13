import { bootInMemory } from "../src/boot";
import { type ForceDisableResult, forceDisableMfa } from "../src/mfa/totp/disable-mfa";

type DisableUserMfaReport = {
  stream: "stdout" | "stderr";
  exitCode: 0 | 1;
  body: Record<string, unknown>;
};

export function toDisableUserMfaReport(
  userId: string,
  result: ForceDisableResult,
): DisableUserMfaReport {
  if (!result.ok) {
    return { stream: "stderr", exitCode: 1, body: { userId, error: result.error } };
  }

  if (!result.changed) {
    return {
      stream: "stdout",
      exitCode: 0,
      body: { userId, changed: false, reason: "mfa_not_enabled" },
    };
  }

  return {
    stream: "stdout",
    exitCode: 0,
    body: { userId, changed: true, notified: result.notified },
  };
}

if (import.meta.main) {
  const userId = process.argv[2];
  if (!userId) {
    console.error("usage: bun run management/disable-user-mfa.ts <userId>");
    process.exit(1);
  }

  const runtime = bootInMemory();
  const report = toDisableUserMfaReport(userId, await runtime.runPromise(forceDisableMfa(userId)));
  const json = JSON.stringify(report.body, null, 2);
  if (report.stream === "stdout") console.log(json);
  else console.error(json);
  process.exit(report.exitCode);
}
