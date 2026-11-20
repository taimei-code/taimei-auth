import type { Html, HtmlBuilder } from "foldkit/html";

export type SettingRow = Readonly<{
  title: string;
  description: string;
  details: ReadonlyArray<Html>;
  actions: ReadonlyArray<Html>;
}>;

export const settingRowView = <Message>(row: SettingRow, h: HtmlBuilder<Message>): Html =>
  h.li(
    [h.Class("flex items-start justify-between gap-4 py-5")],
    [
      h.div(
        [h.Class("min-w-0")],
        [
          h.p([h.Class("font-medium")], [row.title]),
          h.p([h.Class("mt-1 text-sm text-muted-foreground")], [row.description]),
          ...row.details,
        ],
      ),
      h.div([h.Class("flex shrink-0 items-center gap-3")], row.actions),
    ],
  );
