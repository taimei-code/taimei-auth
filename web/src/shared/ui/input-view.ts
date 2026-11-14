import { Input } from "@foldkit/ui";
import { Option } from "effect";
import type { Attribute, Html, HtmlBuilder } from "foldkit/html";

import { Submission } from "../submission";
import { inputClassName, labelClassName } from "./class-names";

export type InputHint = Readonly<{ text: string; maybeErrorMessage: Option.Option<string> }>;

export type InputViewConfig<Message> = Readonly<{
  id: string;
  label: string;
  type: "text" | "email";
  value: string;
  onInput?: (value: string) => Message;
  submission: Submission;
  placeholder: string;
  autocomplete: "name" | "email" | "username" | "organization" | "one-time-code" | "off";
  inputMode?: "numeric" | "text";
  maxLength?: number;
  isAutoCorrectionOff?: boolean;
  hint?: InputHint;
  isDisabled?: boolean;
}>;

const inputHintId = (id: string): string => `${id}-hint`;

const inputErrorId = (id: string): string => `${id}-error`;

const hintAttributes = <Message>(
  id: string,
  maybeHint: InputHint | undefined,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Attribute<Message>> =>
  maybeHint === undefined
    ? []
    : [
        h.AriaInvalid(Option.isSome(maybeHint.maybeErrorMessage)),
        h.AriaDescribedBy(
          Option.match(maybeHint.maybeErrorMessage, {
            onNone: () => inputHintId(id),
            onSome: () => `${inputHintId(id)} ${inputErrorId(id)}`,
          }),
        ),
      ];

const autoCorrectionAttributes = <Message>(
  isAutoCorrectionOff: boolean,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Attribute<Message>> =>
  isAutoCorrectionOff ? [h.Autocapitalize("off"), h.Autocorrect("off"), h.Spellcheck(false)] : [];

export const inputView = <Message>(
  config: InputViewConfig<Message>,
  h: HtmlBuilder<Message>,
): Html =>
  Input.view(
    {
      id: config.id,
      name: config.id,
      type: config.type,
      value: config.value,
      placeholder: config.placeholder,
      onInput: config.onInput,
      isDisabled: config.isDisabled === true || Submission.guards.Submitting(config.submission),
      toView: (attributes) =>
        h.div(
          [h.Class("space-y-2")],
          [
            h.label([...attributes.label, h.Class(labelClassName)], [config.label]),
            ...(config.hint === undefined
              ? []
              : [
                  h.p(
                    [h.Id(inputHintId(config.id)), h.Class("text-xs text-muted-foreground")],
                    [config.hint.text],
                  ),
                ]),
            h.input([
              ...attributes.input,
              h.Required(true),
              h.Class(inputClassName),
              h.Autocomplete(config.autocomplete),
              ...(config.inputMode === undefined ? [] : [h.InputMode(config.inputMode)]),
              ...(config.maxLength === undefined ? [] : [h.Maxlength(config.maxLength)]),
              ...autoCorrectionAttributes(
                config.isAutoCorrectionOff === true || config.type === "email",
                h,
              ),
              ...hintAttributes(config.id, config.hint, h),
            ]),
          ],
        ),
    },
    h,
  );

const inputErrorView = <Message>(id: string, message: string, h: HtmlBuilder<Message>): Html =>
  h.p([h.Id(inputErrorId(id)), h.Role("alert"), h.Class("text-sm text-destructive")], [message]);

export const maybeInputErrorView = <Message>(
  id: string,
  maybeMessage: Option.Option<string>,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  Option.match(maybeMessage, {
    onNone: () => [],
    onSome: (message) => [inputErrorView(id, message, h)],
  });

export const hiddenInputView = <Message>(
  config: Readonly<{ name: string; value: string }>,
  h: HtmlBuilder<Message>,
): Html =>
  Input.view(
    {
      id: config.name,
      type: "hidden",
      name: config.name,
      value: config.value,
      toView: (attributes) => h.input([...attributes.input, h.AriaHidden(true)]),
    },
    h,
  );

export const searchInputView = <Message>(
  config: Readonly<{
    id: string;
    label: string;
    placeholder: string;
    value: string;
    onInput: (value: string) => Message;
    controls: string;
  }>,
  h: HtmlBuilder<Message>,
): Html =>
  Input.view(
    {
      id: config.id,
      name: config.id,
      type: "search",
      value: config.value,
      placeholder: config.placeholder,
      onInput: config.onInput,
      toView: (attributes) =>
        h.search(
          [],
          [
            h.label([...attributes.label, h.Class("sr-only")], [config.label]),
            h.input([
              ...attributes.input,
              h.Class(inputClassName),
              h.Autocomplete("off"),
              ...autoCorrectionAttributes(true, h),
              h.AriaControls(config.controls),
            ]),
          ],
        ),
    },
    h,
  );
