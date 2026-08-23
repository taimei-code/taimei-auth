import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { MfaCodeInput } from "../use-mfa-code-entry";

const unusedEntry: MfaCodeInput = {
  kind: "totp",
  toggleKind: () => undefined,
  toggleLabel: "リカバリーコードを使う",
  labelText: "確認コード",
  hint: "認証アプリに表示されている 6 桁の数字を入力してください。",
  hintId: "mfa-challenge-code-hint",
  errorId: "mfa-challenge-code-error",
  errorMessage: null,
  submitting: false,
  canSubmit: false,
  inputProps: { id: "mfa-challenge-code" },
  handleSubmit: () => undefined,
  reset: () => undefined,
};

test("AC-034 redirecting view は status だけを表示して再入力を許さない", async () => {
  const { MfaChallengeView } = await import("../MfaChallengeView");
  const html = renderToStaticMarkup(
    createElement(MfaChallengeView, {
      view: "redirecting",
      entry: unusedEntry,
    }),
  );

  expect(html).toContain('role="status"');
  expect(html).toContain("ログインを完了しています");
  expect(html).not.toContain('id="mfa-challenge-code"');
  expect(html).not.toContain("ログインを続ける");
});
