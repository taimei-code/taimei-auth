import { describe, expect, test } from "bun:test";
import { RegistryProvider } from "@effect/atom-react";
import { Cause } from "effect";
import { AsyncResult } from "effect/reactivity";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { mfaStatusAtom } from "../../mfa/mfa-atom";
import { Security } from "../pages/Security";

describe("セキュリティ画面", () => {
  test("MFA の状態の取得に失敗すると失敗の文言を alert で出す", () => {
    const html = renderToStaticMarkup(
      createElement(
        RegistryProvider,
        {
          initialValues: [[mfaStatusAtom, AsyncResult.failure(Cause.die(new Error("network")))]],
        },
        createElement(Security),
      ),
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("多要素認証 (MFA) の設定状態を取得できませんでした。");
  });
});
