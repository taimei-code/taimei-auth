import type { Html, HtmlBuilder } from "foldkit/html";

export const nonProductionBannerView = <Message>(h: HtmlBuilder<Message>): Html =>
  h.header(
    [h.Class("bg-primary px-6 py-2 text-sm text-primary-foreground")],
    [
      h.p(
        [],
        [
          h.strong([h.Class("font-semibold")], ["本番以外の環境"]),
          "の画面です。本番の auth ホストにはありません。",
        ],
      ),
    ],
  );
