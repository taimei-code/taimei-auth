import { describe, expect, test } from "bun:test";
import { parseReleaseArgs, RELEASE_USAGE } from "../release-args";

describe("parseReleaseArgs", () => {
  test("--reason の直後に別フラグが来たら usage error", () => {
    expect(parseReleaseArgs(["user-1", "--reason", "--process-stopped-confirmed"])).toEqual({
      error: RELEASE_USAGE,
    });
  });

  test("userId の位置にフラグが来たら usage error", () => {
    expect(parseReleaseArgs(["--reason", "incident", "--process-stopped-confirmed"])).toEqual({
      error: RELEASE_USAGE,
    });
  });

  test("引用符を忘れた reason の余剰 token は usage error (audit の切り詰め防止)", () => {
    expect(
      parseReleaseArgs(["user-1", "--reason", "incident", "999", "--process-stopped-confirmed"]),
    ).toEqual({ error: RELEASE_USAGE });
  });

  test("正常な argv を management input に変換する", () => {
    expect(
      parseReleaseArgs(["user-1", "--reason", "incident", "--process-stopped-confirmed"]),
    ).toEqual({
      userId: "user-1",
      reason: "incident",
      processStoppedConfirmed: true,
    });
  });
});
