import { describe, expect, test } from "bun:test";
import { memberLabel, orgCodeLabelJa, providerLabel } from "../labels";

describe("memberLabel", () => {
  test("名前があれば名前を返す", () => {
    expect(memberLabel({ user_name: "山田 太郎", user_email: "taro@example.com" })).toBe(
      "山田 太郎",
    );
  });

  test("名前未設定 (空文字) は email に倒す", () => {
    expect(memberLabel({ user_name: "", user_email: "taro@example.com" })).toBe("taro@example.com");
  });
});

describe("orgCodeLabelJa", () => {
  test("PERSONAL は個人事業主", () => {
    expect(orgCodeLabelJa("PERSONAL")).toBe("個人事業主");
  });

  test("未知値は法人に倒す (複製元 3 箇所の現行挙動の踏襲)", () => {
    expect(orgCodeLabelJa("UNKNOWN")).toBe("法人");
  });
});

describe("providerLabel", () => {
  test("github は正式表記 GitHub", () => {
    expect(providerLabel("github")).toBe("GitHub");
  });

  test("未知 provider は素の id を返す", () => {
    expect(providerLabel("gitlab")).toBe("gitlab");
  });
});
