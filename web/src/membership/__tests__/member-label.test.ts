import { describe, expect, test } from "bun:test";
import { memberLabel } from "../member-label";

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
