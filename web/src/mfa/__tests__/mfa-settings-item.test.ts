import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MfaSettingsItem } from "../MfaSettingsItem";

const refresh = async () => undefined;

describe("MfaSettingsItem", () => {
  test("enabled は badge、残数、警告、disable を既存順で表示する", () => {
    const html = renderToStaticMarkup(
      createElement(MfaSettingsItem, {
        status: { enabled: true, in_effect: true, recovery_codes_remaining: 3 },
        refresh,
      }),
    );

    expect(html).toContain("多要素認証 (MFA)");
    expect(html).toContain("リカバリーコードの残り: 3 個");
    expect(html).toContain("リカバリーコードの残りが少なくなっています");
    expect(html).toContain("有効");
    expect(html).toContain("無効にする");
    expect(html).not.toContain("有効にする");
  });

  test("enabled=false でも in_effect=true は自己復旧用 disable を表示する", () => {
    const html = renderToStaticMarkup(
      createElement(MfaSettingsItem, {
        status: { enabled: false, in_effect: true, recovery_codes_remaining: 0 },
        refresh,
      }),
    );

    expect(html).toContain("無効");
    expect(html).toContain("無効にする");
    expect(html).not.toContain("有効にする");
  });

  test("in_effect=false は enroll を表示する", () => {
    const html = renderToStaticMarkup(
      createElement(MfaSettingsItem, {
        status: { enabled: false, in_effect: false, recovery_codes_remaining: 0 },
        refresh,
      }),
    );

    expect(html).toContain("無効");
    expect(html).toContain("有効にする");
    expect(html).not.toContain("無効にする");
  });
});
