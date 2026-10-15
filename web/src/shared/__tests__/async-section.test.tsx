import { describe, expect, test } from "bun:test";
import { Cause, Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import { renderToStaticMarkup } from "react-dom/server";

import { AsyncSection } from "../AsyncSection";

const render = (result: AsyncResult.AsyncResult<readonly string[], string>) =>
  renderToStaticMarkup(
    <AsyncSection
      result={result}
      failedText="取得に失敗しました"
      empty={{ when: (items) => items.length === 0, text: "ありません" }}
    >
      {(items) => items.join(",")}
    </AsyncSection>,
  );

describe("AsyncSection は読み出しの結果をそのまま受けて出し分ける", () => {
  test("最初の取得の前は読み込み中の行を出す", () => {
    expect(render(AsyncResult.initial())).toContain('role="status"');
  });

  test("値を得る前に失敗すると、失敗の文言を alert で出す", () => {
    const html = render(AsyncResult.failure(Cause.fail("unavailable")));

    expect(html).toContain('role="alert"');
    expect(html).toContain("取得に失敗しました");
    expect(html).not.toContain("ありません");
  });

  test("値が空なら空の文言を、空でなければ値を出す", () => {
    expect(render(AsyncResult.success([]))).toContain("ありません");
    expect(render(AsyncResult.success(["a", "b"]))).toContain("a,b");
  });

  test("前の値がある失敗 (取り直しの失敗) は前の値を出し続ける", () => {
    const html = render(
      AsyncResult.failure(Cause.fail("unavailable"), {
        previousSuccess: Option.some(AsyncResult.success(["a"])),
      }),
    );

    expect(html).toContain("a");
    expect(html).not.toContain("取得に失敗しました");
  });
});
