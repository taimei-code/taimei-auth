import { describe, expect, test } from "bun:test";
import { isMfaChallengeEnabled } from "../kill-switch";

type KillSwitchCase = { name: string; raw: string | undefined; enabled: boolean };

const KILL_SWITCH_CASES: KillSwitchCase[] = [
  { name: "未設定 (undefined)", raw: undefined, enabled: true },
  { name: "空文字", raw: "", enabled: true },
  { name: "数値 0", raw: "0", enabled: true },
  { name: "off", raw: "off", enabled: true },
  { name: "no", raw: "no", enabled: true },
  { name: "大文字 FALSE", raw: "FALSE", enabled: true },
  { name: "先頭大文字 False", raw: "False", enabled: true },
  { name: "前置空白 ' false'", raw: " false", enabled: true },
  { name: "後置空白 'false '", raw: "false ", enabled: true },
  { name: "改行付き 'false\\n'", raw: "false\n", enabled: true },
  { name: "true", raw: "true", enabled: true },
  { name: "1", raw: "1", enabled: true },
  { name: "on", raw: "on", enabled: true },
  { name: "綴り違い fasle", raw: "fasle", enabled: true },
  { name: "完全一致 false", raw: "false", enabled: false },
];

describe("isMfaChallengeEnabled (MFA_CHALLENGE_ENABLED の解釈)", () => {
  test.each(KILL_SWITCH_CASES)("QA-M-13 $name → enabled:$enabled", ({
    raw,
    enabled,
  }: KillSwitchCase) => {
    expect(isMfaChallengeEnabled(raw)).toBe(enabled);
  });

  test("QA-M-13 チャレンジを止められる値は 'false' 完全一致のみ (設定漏れ・綴り違いは on 側へ倒れる)", () => {
    const disablingValues = KILL_SWITCH_CASES.filter((c) => !isMfaChallengeEnabled(c.raw)).map(
      (c) => c.raw,
    );
    expect(disablingValues).toEqual(["false"]);
  });
});
