import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { given, message, model, story } from "foldkit/story";

import { init, Message, update } from "../FeatureFlags";
import type { FeatureFlagsProps } from "../page-props";

const opened = (notice: FeatureFlagsProps["notice"]) =>
  init(
    Option.some({
      _tag: "FeatureFlags",
      homeHref: "/dev-home",
      switchAction: "/dev-home/feature-flags",
      notice,
      flags: [{ name: "passkey", audience: "everyone", status: "On", companies: [] }],
    }),
  );

describe("フィーチャーフラグのページを開いた時", () => {
  test("知らせが無ければ、絞り込みの文字は空で、通信も focus の移動もしない", () => {
    const opening = opened(null);
    expect(opening.model.query).toBe("");
    expect(opening.commands).toBeUndefined();
  });

  test("切り替えた後に開くと、知らせへ focus を移す", () => {
    expect(opened({ _tag: "Switched", flag: "passkey", state: "off" }).commands).toMatchObject([
      { name: "FocusFlagNotice" },
    ]);
  });
});

describe("フィーチャーフラグのページの絞り込み", () => {
  test("絞り込み欄に入れた文字を、最後の入力のとおりに持つ", () => {
    story(
      update,
      given(opened(null).model),
      message(Message.UpdatedQuery({ query: "pass" })),
      message(Message.UpdatedQuery({ query: "passkey" })),
      model((next) => {
        expect(next.query).toBe("passkey");
      }),
    );
  });
});

describe("フィーチャーフラグのページの事業所 ID の欄", () => {
  test("書きかけの ID をフラグごとに持ち、絞り込みで描き直しても消さない", () => {
    story(
      update,
      given(opened(null).model),
      message(Message.UpdatedCompanyIds({ flag: "example", text: "cmp-1\ncmp-2" })),
      message(Message.UpdatedQuery({ query: "ex" })),
      model((next) => {
        expect(next.companyIdDrafts).toEqual({ example: "cmp-1\ncmp-2" });
      }),
    );
  });
});
