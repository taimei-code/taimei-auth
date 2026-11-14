import type { CrashContext } from "foldkit/runtime";
import type { Document, HtmlBuilder } from "foldkit/html";

export const crashView = <Model, Message>(
  _context: CrashContext<Model, Message>,
  h: HtmlBuilder<never>,
): Document => ({
  title: "taimei-auth",
  body: h.main(
    [h.Class("p-2")],
    [
      h.h1(
        [h.Class("text-base font-semibold")],
        ["問題が発生しました。ページを再読み込みしてください。"],
      ),
    ],
  ),
});
