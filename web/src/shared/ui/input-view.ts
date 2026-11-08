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
  onInput: (value: string) => Message;
  submission: Submission;
  placeholder: string;
  autocomplete?: string;
  inputMode?: "numeric" | "text";
  ariaLabel?: string;
  maxLength?: number;
  isAutoCorrectionOff?: boolean;
  hint?: InputHint;
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
  isAutoCorrectionOff: boolean | undefined,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Attribute<Message>> =>
  isAutoCorrectionOff === true
    ? [h.Autocapitalize("off"), h.Autocorrect("off"), h.Spellcheck(false)]
    : [];

export const inputView = <Message>(
  config: InputViewConfig<Message>,
  h: HtmlBuilder<Message>,
): Html =>
  Input.view(
    {
      id: config.id,
      type: config.type,
      value: config.value,
      placeholder: config.placeholder,
      onInput: config.onInput,
      isDisabled: Submission.guards.Submitting(config.submission),
      toView: (attributes) =>
        h.div(
          [h.Class("space-y-2")],
          [
            h.label([...attributes.label, h.Class(labelClassName)], [config.label]),
            h.input([
              ...attributes.input,
              h.Required(true),
              h.Class(inputClassName),
              ...(config.autocomplete === undefined ? [] : [h.Autocomplete(config.autocomplete)]),
              ...(config.inputMode === undefined ? [] : [h.InputMode(config.inputMode)]),
              ...(config.ariaLabel === undefined ? [] : [h.AriaLabel(config.ariaLabel)]),
              ...(config.maxLength === undefined ? [] : [h.Maxlength(config.maxLength)]),
              ...autoCorrectionAttributes(config.isAutoCorrectionOff, h),
              ...hintAttributes(config.id, config.hint, h),
            ]),
            ...(config.hint === undefined
              ? []
              : [
                  h.p(
                    [h.Id(inputHintId(config.id)), h.Class("text-xs text-muted-foreground")],
                    [config.hint.text],
                  ),
                ]),
          ],
        ),
    },
    h,
  );

export const inputErrorView = <Message>(
  id: string,
  message: string,
  h: HtmlBuilder<Message>,
): Html =>
  h.p([h.Id(inputErrorId(id)), h.Role("alert"), h.Class("text-sm text-destructive")], [message]);

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
