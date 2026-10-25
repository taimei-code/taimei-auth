import { describe, expect, test } from "bun:test";
import {
  NON_PRODUCTION_SCRIPT_HREF,
  NON_PRODUCTION_STYLESHEET_HREF,
} from "../../web/non-production/assets";
import { nonProductionShell } from "../non-production-shell";

const shell = async () =>
  String(
    await nonProductionShell({
      _tag: "DevHome",
      devAccounts: [],
      browserAccounts: [],
      viewer: { _tag: "SignedOut", notice: "None" },
      destination: { _tag: "AccountPage" },
      signInAction: "/sign-in",
      signOutAction: "/sign-out",
    }),
  );

describe("本番以外の画面の HTML は、web の build が本番以外の時に出す CSS と script を読み、画面は browser で描く", () => {
  test("web の build が本番以外の時に出す stylesheet と module script を読む", async () => {
    const body = await shell();

    expect(body).toContain(`<link rel="stylesheet" href="${NON_PRODUCTION_STYLESHEET_HREF}" />`);
    expect(body).toContain(`<script type="module" src="${NON_PRODUCTION_SCRIPT_HREF}"></script>`);
    expect(body).toContain('<div id="root"></div>');
  });

  test("viewport の meta と、画面ごとの title を持つ", async () => {
    const body = await shell();

    expect(body).toContain(
      '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    );
    expect(body).toContain("<title>開発者ホーム</title>");
  });
});
