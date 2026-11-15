import { describe, expect as expectBun, test } from "bun:test";
import { Option } from "effect";
import {
  click,
  Command,
  expect,
  given,
  label,
  role,
  scene,
  submit,
  tap,
  text,
  type,
} from "foldkit/scene";
import { fromString } from "foldkit/url";

import { init, update, view } from "../web/src/app/auth/main";
import * as MfaChallenge from "../web/src/mfa/pages/MfaChallenge";

const AUTH_ORIGIN = "https://auth.taimei-code.com";
const SEARCH = new URLSearchParams({
  service_name: "taimei",
  redirect_url: "https://app.taimei-code.com/",
}).toString();
const SIGN_IN = `${AUTH_ORIGIN}/auth?${SEARCH}`;
const SIGN_UP = `${AUTH_ORIGIN}/auth/signup?${SEARCH}`;

const modelAt = (href: string) =>
  init(Option.getOrThrowWith(fromString(href), () => new Error(href))).model;

type VNodeLike = {
  sel?: string;
  text?: string;
  data?: { attrs?: Record<string, unknown>; props?: Record<string, unknown> };
  children?: ReadonlyArray<VNodeLike | string>;
};

const STOP = new Error("observed");

const observeAuth = (href: string, ...steps: unknown[]) => {
  try {
    scene(
      { update, view } as never,
      given(modelAt(href)) as never,
      ...(steps as never[]),
      tap(() => {
        throw STOP;
      }) as never,
    );
  } catch (error) {
    if (error !== STOP) throw error;
  }
};

const nodesIn = (node: VNodeLike | string | undefined): VNodeLike[] =>
  typeof node === "object" && node !== null
    ? [node, ...(node.children ?? []).flatMap((child) => nodesIn(child))]
    : [];

const textOf = (node: VNodeLike | string | undefined): string =>
  typeof node === "string"
    ? node
    : `${node?.text ?? ""}${(node?.children ?? []).map((child) => textOf(child)).join("")}`;

const attrOf = (node: VNodeLike, name: string) =>
  node.data?.attrs?.[name] ?? node.data?.props?.[name];

describe("送らせて誤りを示す form (#464)", () => {
  test("AC-001: ログインの form で、メールアドレスが空のまま送信のボタンを押すと、「メールアドレスを入力してください。」が出て、入力欄が aria-invalid=\"true\" になる", () => {
    observeAuth(
      SIGN_IN,
      click(role("button", { name: "Magic Link を送信" })),
      expect(text("メールアドレスを入力してください。")).toExist(),
      expect(label("メールアドレス")).toHaveAttr("aria-invalid", "true"),
    );
  });

  test("AC-002: 登録の form で、空のまま送信のボタンを押すと、最初の欄 (お名前) に「お名前を入力してください。」が出て、その欄が aria-invalid=\"true\" になる", () => {
    observeAuth(
      SIGN_UP,
      click(role("button", { name: "Magic Link で登録" })),
      expect(text("お名前を入力してください。")).toExist(),
      expect(label("お名前")).toHaveAttr("aria-invalid", "true"),
    );
  });

  test("AC-003: ログインの form で、空白だけのメールアドレスで送信すると、空と同じ誤りを示す", () => {
    observeAuth(
      SIGN_IN,
      type(label("メールアドレス"), "   "),
      click(role("button", { name: "Magic Link を送信" })),
      expect(text("メールアドレスを入力してください。")).toExist(),
      expect(label("メールアドレス")).toHaveAttr("aria-invalid", "true"),
    );
  });

  test("AC-004: 触る前の入力欄は aria-invalid=\"false\" を持つ", () => {
    observeAuth(SIGN_IN, expect(label("メールアドレス")).toHaveAttr("aria-invalid", "false"));
    observeAuth(
      SIGN_UP,
      expect(label("お名前")).toHaveAttr("aria-invalid", "false"),
      expect(label("メールアドレス")).toHaveAttr("aria-invalid", "false"),
    );
  });

  test("AC-005: 誤りを示した欄に値を入れると、aria-invalid=\"false\" に戻り、誤りの文言が消える", () => {
    observeAuth(
      SIGN_IN,
      click(role("button", { name: "Magic Link を送信" })),
      type(label("メールアドレス"), "user@example.com"),
      expect(label("メールアドレス")).toHaveAttr("aria-invalid", "false"),
      expect(text("メールアドレスを入力してください。")).toBeAbsent(),
    );
  });

  test("AC-006: MFA のコードを server が拒んだ後、入力欄の aria-describedby が誤りの文言の要素を指す", () => {
    const entering = {
      ...MfaChallenge.init({ visit: 1, signInHref: "/auth" }).model,
      phase: { _tag: "Entering", kind: "totp", code: "", submission: { _tag: "Idle" } },
    } as MfaChallenge.Model;
    let describedTexts: string[] = [];
    try {
      scene(
        { update: MfaChallenge.update, view: MfaChallenge.view },
        given(entering),
        type(label("確認コード"), "123456"),
        submit(role("form")),
        Command.resolve(
          MfaChallenge.VerifyCode,
          MfaChallenge.Message.FailedVerifyCode({ visit: 1, failure: "InvalidCode" }),
        ),
        tap(({ html }) => {
          const nodes = nodesIn(html as VNodeLike);
          const input = nodes.find((node) => node.sel?.startsWith("input") === true);
          const describedBy = input === undefined ? undefined : attrOf(input, "aria-describedby");
          const ids = (typeof describedBy === "string" ? describedBy : "")
            .split(" ")
            .filter((id) => id !== "");
          describedTexts = ids.map((id) => textOf(nodes.find((node) => attrOf(node, "id") === id)));
          throw STOP;
        }),
      );
    } catch (error) {
      if (error !== STOP) throw error;
    }
    expectBun(describedTexts).toContain("入力されたコードが正しくありません。");
  });

  test("AC-007: 必須の欄は label の隣に印を持ち、form は印が必須を表すことを説明する", () => {
    let marks = 0;
    let explained = false;
    observeAuth(
      SIGN_IN,
      tap(({ html }) => {
        const nodes = nodesIn(html as VNodeLike);
        marks = nodes.filter(
          (node) => attrOf(node, "aria-hidden") === "true" && textOf(node) === "*",
        ).length;
        explained = nodes.some(
          (node) =>
            attrOf(node, "aria-hidden") !== "true" &&
            node.sel?.startsWith("p") === true &&
            textOf(node).includes("*") &&
            textOf(node).includes("必須"),
        );
      }),
    );
    expectBun(marks).toBeGreaterThan(0);
    expectBun(explained).toBe(true);
  });
});
