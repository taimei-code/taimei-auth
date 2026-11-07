import type { CrashContext } from "foldkit/runtime";
import type { Document, HtmlBuilder } from "foldkit/html";

export const crashView = <Model, Message>(
  _context: CrashContext<Model, Message>,
  h: HtmlBuilder<never>,
): Document => ({
  title: "taimei-auth",
  body: h.div(
    [h.Style({ padding: ".5rem", maxWidth: "100%" })],
    [h.strong([h.Style({ fontSize: "1rem" })], ["Something went wrong!"])],
  ),
});
