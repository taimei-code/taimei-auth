import { Input } from "@foldkit/ui";
import { Option } from "effect";
import type { Attribute, Html, HtmlBuilder } from "foldkit/html";

import { Submission } from "../submission";
import { inputClassName, labelClassName } from "./class-names";

export type InputViewConfig<Message> = Readonly<{
  id: string;
  label: string;
  type: "text" | "email";
  value: string;
  onInput?: (value: string) => Message;
  submission: Submission;
  placeholder: string;
  autocomplete: "name" | "email" | "username" | "organization" | "one-time-code" | "off";
  enterKeyHint: "go" | "send" | "next" | "done";
  maybeErrorMessage: Option.Option<string>;
  inputMode?: "numeric" | "text";
  maxLength?: number;
  isAutoCorrectionOff?: boolean;
  hint?: string;
  isDisabled?: boolean;
}>;

const inputHintId = (id: string): string => `${id}-hint`;

const inputErrorId = (id: string): string => `${id}-error`;

const describedByIds = <Message>(config: InputViewConfig<Message>): ReadonlyArray<string> => [
  ...(config.hint === undefined ? [] : [inputHintId(config.id)]),
  ...(Option.isSome(config.maybeErrorMessage) ? [inputErrorId(config.id)] : []),
];

const describedByAttributes = <Message>(
  config: InputViewConfig<Message>,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Attribute<Message>> => {
  const ids = describedByIds(config);
  return ids.length === 0 ? [] : [h.AriaDescribedBy(ids.join(" "))];
};

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
            h.div(
              [h.Class("flex items-baseline gap-1")],
              [
                h.label([...attributes.label, h.Class(labelClassName)], [config.label]),
                ...(config.isDisabled === true
                  ? []
                  : [h.span([h.AriaHidden(true), h.Class("text-sm text-destructive")], ["*"])]),
              ],
            ),
            ...(config.hint === undefined
              ? []
              : [
                  h.p(
                    [h.Id(inputHintId(config.id)), h.Class("text-xs text-muted-foreground")],
                    [config.hint],
                  ),
                ]),
            h.input([
              ...attributes.input,
              h.Required(config.isDisabled !== true),
              h.Class(inputClassName),
              h.Autocomplete(config.autocomplete),
              h.EnterKeyHint(config.enterKeyHint),
              h.AriaInvalid(Option.isSome(config.maybeErrorMessage)),
              ...describedByAttributes(config, h),
              ...(config.inputMode === undefined ? [] : [h.InputMode(config.inputMode)]),
              ...(config.maxLength === undefined ? [] : [h.Maxlength(config.maxLength)]),
              ...autoCorrectionAttributes(
                config.isAutoCorrectionOff === true || config.type === "email",
                h,
              ),
            ]),
            ...Option.match(config.maybeErrorMessage, {
              onNone: () => [],
              onSome: (message) => [
                h.p(
                  [h.Id(inputErrorId(config.id)), h.Class("text-sm text-destructive")],
                  [message],
                ),
              ],
            }),
          ],
        ),
    },
    h,
  );

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
