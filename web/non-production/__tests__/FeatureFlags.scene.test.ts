import { describe, test } from "bun:test";
import { Option } from "effect";
import { expect, given, inside, role, scene, text, type, within } from "foldkit/scene";

import type { FeatureFlagsProps } from "../page-props";

type FlagOnPage = FeatureFlagsProps["flags"][number];

const PASSKEY: FlagOnPage = {
  name: "passkey",
  audience: "everyone",
  status: "On",
  companies: [],
};
const COMPANY_FLAG: FlagOnPage = {
  name: "example-company-flag",
  audience: "companies",
  status: "OnlyFor",
  companies: [{ id: "cmp-1", name: "事業所 1" }],
};

const props = (flags: ReadonlyArray<FlagOnPage>): FeatureFlagsProps => ({
  _tag: "FeatureFlags",
  homeHref: "/dev-home?q=1",
  switchAction: "/dev-home/feature-flags?q=1",
  notice: null,
  flags,
});

const program = async (flags: ReadonlyArray<FlagOnPage>) => {
  const { init, update, view } = await import("../FeatureFlags");
  return { update, view, model: init(Option.some(props(flags))).model };
};

const flagTable = role("table", { name: "フィーチャーフラグのステータスと切り替え" });
const flagFilter = role("searchbox", { name: "フラグを絞り込む" });

const manyFlags = Array.from({ length: 9 }, (_, index) => ({
  ...PASSKEY,
  name: index < 3 ? `sign-in-flag-${index}` : `other-flag-${index}`,
}));

describe("フィーチャーフラグのページは、フラグごとのステータスと切り替えを描く", () => {
  test("フラグの名前とステータスを描き、事業所だけ on の時は事業所の名前と ID を並べる", async () => {
    const { update, view, model } = await program([PASSKEY, COMPANY_FLAG]);

    scene(
      { update, view },
      given(model),
      inside(
        flagTable,
        expect(role("rowheader", { name: "passkey" })).toExist(),
        expect(text("全体 on")).toExist(),
        expect(role("rowheader", { name: "example-company-flag" })).toExist(),
        expect(text("事業所だけ on")).toExist(),
        expect(text("事業所 1")).toExist(),
        expect(text("cmp-1")).toExist(),
      ),
    );
  });

  test("切り替えのボタンは今と違う状態だけを、フラグ名を含む名前で出す", async () => {
    const { update, view, model } = await program([PASSKEY]);

    scene(
      { update, view },
      given(model),
      expect(role("button", { name: "passkey を 全体 off にする" })).toExist(),
      expect(role("button", { name: "passkey を 全体 on にする" })).toBeAbsent(),
    );
  });

  test("事業所 ID を書いて on にする操作は、事業所で決まるフラグにだけ出す", async () => {
    const { update, view, model } = await program([PASSKEY, COMPANY_FLAG]);

    scene(
      { update, view },
      given(model),
      expect(role("textbox", { name: "on にする事業所 ID" })).toHaveValue("cmp-1"),
      expect(
        role("button", { name: "example-company-flag を この事業所だけ on にする" }),
      ).toExist(),
      expect(role("button", { name: "passkey を この事業所だけ on にする" })).toBeAbsent(),
    );
  });
});

describe("フィーチャーフラグのページは、フラグが多い時だけ名前で絞り込める", () => {
  test("フラグが 8 件以下なら、絞り込み欄を出さない", async () => {
    const { update, view, model } = await program(manyFlags.slice(0, 8));

    scene({ update, view }, given(model), expect(flagFilter).toBeAbsent());
  });

  test("フラグが 8 件を超えると絞り込み欄を出し、残った件数を知らせ、一致しなければそう知らせる", async () => {
    const { update, view, model } = await program(manyFlags);

    scene(
      { update, view },
      given(model),
      type(flagFilter, "sign-in"),
      expect(role("status")).toHaveText("9 件のうち 3 件を表示しています。"),
      expect(within(flagTable, role("rowheader", { name: "other-flag-3" }))).toBeAbsent(),
      type(flagFilter, "no-such-flag"),
      expect(role("status")).toHaveText("「no-such-flag」に一致するフラグはありません。"),
    );
  });
});
