import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

export const alertTextView = <Message>(text: string, h: HtmlBuilder<Message>): Html =>
  h.p([h.Role("alert"), h.Class("text-sm text-destructive")], [text]);

export const maybeAlertTextView = <Message>(
  maybeText: Option.Option<string>,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  Option.match(maybeText, {
    onNone: () => [],
    onSome: (text) => [alertTextView(text, h)],
  });
