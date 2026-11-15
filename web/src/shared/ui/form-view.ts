import type { Attribute, Html, HtmlBuilder } from "foldkit/html";

const REQUIRED_MARK_EXPLANATION = "* は必須の項目です。";

export const formView = <Message>(
  config: Readonly<{
    onSubmit: Message;
    attributes?: ReadonlyArray<Attribute<Message>>;
    children: ReadonlyArray<Html>;
  }>,
  h: HtmlBuilder<Message>,
): Html =>
  h.form(
    [h.Novalidate(true), h.OnSubmit(config.onSubmit), ...(config.attributes ?? [])],
    [
      h.p(
        [h.Class("w-full basis-full text-xs text-muted-foreground")],
        [REQUIRED_MARK_EXPLANATION],
      ),
      ...config.children,
    ],
  );
