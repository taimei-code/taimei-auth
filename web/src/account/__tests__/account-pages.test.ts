import { describe, expect, test } from "bun:test";
import { RegistryProvider } from "@effect/atom-react";
import { Cause } from "effect";
import { AsyncResult, type Atom } from "effect/reactivity";
import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { mfaStatusAtom } from "../../mfa/mfa-atom";
import { AuthClientReadFailed, linkedAccountsAtom, sessionsAtom } from "../account-atom";
import { Connections } from "../pages/Connections";
import { Security } from "../pages/Security";
import { Sessions } from "../pages/Sessions";

const renderWith = <A, E>(
  page: FunctionComponent,
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>,
  result: AsyncResult.AsyncResult<A, E>,
) =>
  renderToStaticMarkup(
    createElement(RegistryProvider, { initialValues: [[atom, result]] }, createElement(page)),
  );

const failed = AsyncResult.failure(Cause.fail(new AuthClientReadFailed({ status: 500 })));

describe("セッション画面", () => {
  test("better-auth が失敗を返すと失敗の文言を出し、セッションが無いとは出さない", () => {
    const html = renderWith(Sessions, sessionsAtom, failed);

    expect(html).toContain('role="alert"');
    expect(html).toContain("セッションの取得に失敗しました");
    expect(html).not.toContain("アクティブなセッションはありません。");
  });

  test("空の一覧ならセッションが無いと出す", () => {
    expect(renderWith(Sessions, sessionsAtom, AsyncResult.success([]))).toContain(
      "アクティブなセッションはありません。",
    );
  });

  test("一覧の session の user agent を出す", () => {
    const session = {
      id: "s1",
      userAgent: "Firefox on Linux",
      ipAddress: "192.0.2.1",
      expiresAt: new Date("2026-10-20T00:00:00Z"),
    };
    const html = renderWith(
      Sessions,
      sessionsAtom,
      AsyncResult.success([session]) as unknown as Atom.Type<typeof sessionsAtom>,
    );

    expect(html).toContain("Firefox on Linux");
  });
});

describe("連携アカウント画面", () => {
  test("better-auth が失敗を返すと失敗の文言を出し、連携アカウントが無いとは出さない", () => {
    const html = renderWith(Connections, linkedAccountsAtom, failed);

    expect(html).toContain('role="alert"');
    expect(html).toContain("連携アカウントの取得に失敗しました");
    expect(html).not.toContain("連携アカウントはありません。");
  });

  test("空の一覧なら連携アカウントが無いと出す", () => {
    expect(renderWith(Connections, linkedAccountsAtom, AsyncResult.success([]))).toContain(
      "連携アカウントはありません。",
    );
  });
});

describe("セキュリティ画面", () => {
  test("MFA の状態の取得に失敗すると失敗の文言を alert で出す", () => {
    const html = renderWith(
      Security,
      mfaStatusAtom,
      AsyncResult.failure(Cause.die(new Error("network"))),
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("多要素認証 (MFA) の設定状態を取得できませんでした。");
  });
});
