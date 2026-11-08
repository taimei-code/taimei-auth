import type { Html, HtmlBuilder } from "foldkit/html";

import { separatorClassName } from "../shared/ui/class-names";

export const separatorView = <Message>(spacing: "my-6" | "my-10", h: HtmlBuilder<Message>): Html =>
  h.div([h.Role("separator"), h.Class(`${separatorClassName} ${spacing}`)]);

export const pageTitleView = <Message>(
  title: string,
  description: string,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [],
    [
      h.h1([h.Class("text-xl font-semibold tracking-tight")], [title]),
      h.p([h.Class("mt-1 text-sm text-muted-foreground")], [description]),
    ],
  );

export const accountPageHeaderView = <Message>(
  title: string,
  description: string,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> => [pageTitleView(title, description, h), separatorView("my-6", h)];

export const listEmptyView = <Message>(text: string, h: HtmlBuilder<Message>): Html =>
  h.p([h.Class("text-sm text-muted-foreground")], [text]);

export const listFootnoteView = <Message>(text: string, h: HtmlBuilder<Message>): Html =>
  h.p([h.Class("mt-6 text-xs text-muted-foreground")], [text]);
