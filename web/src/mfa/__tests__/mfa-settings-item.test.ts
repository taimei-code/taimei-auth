import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ENROLL_HOST_ID } from "../MfaEnrollDialog";
import { MfaSettingsItem } from "../MfaSettingsItem";

describe("MfaSettingsItem", () => {
  test("enabled は badge、残数、警告、disable を既存順で表示する", () => {
    const html = renderToStaticMarkup(
      createElement(MfaSettingsItem, {
        status: { enabled: true, recovery_codes_remaining: 3 },
      }),
    );

    expect(html).toContain("多要素認証 (MFA)");
    expect(html).toContain("リカバリーコードの残り: 3 個");
    expect(html).toContain("リカバリーコードの残りが少なくなっています");
    expect(html).toContain("有効");
    expect(html).toContain("無効にする");
    expect(html).not.toContain("有効にする");
    expect(html).not.toContain(`id="${ENROLL_HOST_ID}"`);
  });

  test("enabled=false は disable を出さず、enroll の画面を browser で埋め込む場所を置く", () => {
    const html = renderToStaticMarkup(
      createElement(MfaSettingsItem, {
        status: { enabled: false, recovery_codes_remaining: 0 },
      }),
    );

    expect(html).toContain("無効");
    expect(html).toContain(`id="${ENROLL_HOST_ID}"`);
    expect(html).not.toContain("無効にする");
  });
});
