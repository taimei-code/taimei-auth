import { describe, expect, test } from "bun:test";
import { sanitizeDisplayText } from "../sanitize";

// user 入力由来の表示名 / company 名は招待メールの件名・本文に流れ込む
// (send-invitation.ts が唯一の利用箇所)。CR/LF が残ると SMTP ヘッダインジェクション、
// 方向制御・zero-width が残ると表示名偽装 (phishing) になるため、除去境界を固定する。

describe("sanitizeDisplayText", () => {
  describe("正常系: 通常の表示名は不変", () => {
    test.each([
      ["日本語 + 空白", "山田 太郎"],
      ["会社名", "株式会社テスト"],
      ["ASCII", "John Smith Jr."],
      ["絵文字は除去対象外", "開発チーム🚀"],
    ])("%s", (_name, input) => {
      expect(sanitizeDisplayText(input)).toBe(input);
    });
  });

  describe("異常系: インジェクション検体の除去", () => {
    test("CR/LF (SMTP ヘッダインジェクション) を除去する", () => {
      expect(sanitizeDisplayText("山田\r\nBcc: attacker@evil.com 太郎")).toBe(
        "山田Bcc: attacker@evil.com 太郎",
      );
    });

    test("RTL override (表示名偽装) を除去する", () => {
      expect(sanitizeDisplayText("abc‮def")).toBe("abcdef");
    });

    test("zero-width 文字を除去する", () => {
      expect(sanitizeDisplayText("株式​会社")).toBe("株式会社");
    });
  });

  describe("エッジケース: 除去 6 レンジの境界 1 点ずつ + trim", () => {
    test.each([
      ["C0 制御文字上端 0x1F", "ab"],
      ["DEL 0x7F", "ab"],
      ["C1 制御文字上端 0x9F", "ab"],
      ["zero-width joiner 0x200D", "a‍b"],
      ["BOM 0xFEFF", "a﻿b"],
      ["RTL/LTR override 端 0x202A", "a‪b"],
      ["isolate 端 0x2069", "a⁩b"],
    ])("%s は除去される", (_name, input) => {
      expect(sanitizeDisplayText(input)).toBe("ab");
    });

    test("除去対象レンジの外側 (0x20 空白 / 0x2070) は残る", () => {
      expect(sanitizeDisplayText("a b")).toBe("a b");
      expect(sanitizeDisplayText("a⁰b")).toBe("a⁰b");
    });

    test("前後空白は trim される", () => {
      expect(sanitizeDisplayText("  山田 太郎  ")).toBe("山田 太郎");
    });

    test("制御文字のみの入力は空文字になる", () => {
      expect(sanitizeDisplayText("\r\n‮​")).toBe("");
    });
  });
});
