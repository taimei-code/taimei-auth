import { Select } from "@foldkit/ui";
import { Schema } from "effect";
import type { Attribute, Html, HtmlBuilder } from "foldkit/html";
import { defineTaggedUnion } from "foldkit/schema";

import { cn } from "../utils";
import { labelClassName, nativeSelectClassNames } from "./class-names";

export type SelectOption = Readonly<{ value: string; label: string }>;

export type SelectViewConfig<Message> = Readonly<{
  id: string;
  ariaLabel: string;
  title: string;
  value: string;
  options: ReadonlyArray<SelectOption>;
  isDisabled: boolean;
  onChange: (value: string) => Message;
}>;

const SelectLabel = defineTaggedUnion({
  Visible: { text: Schema.String },
  AriaOnly: { text: Schema.String },
});
type SelectLabel = typeof SelectLabel.Type;

type NativeSelectConfig<Message> = Readonly<{
  id: string;
  label: SelectLabel;
  value: string;
  options: ReadonlyArray<SelectOption>;
  isDisabled: boolean;
  onChange: (value: string) => Message;
  className: string;
  extraAttributes: ReadonlyArray<Attribute<Message>>;
}>;

const nativeSelectView = <Message>(
  config: NativeSelectConfig<Message>,
  h: HtmlBuilder<Message>,
): Html =>
  Select.view(
    {
      id: config.id,
      name: config.id,
      value: config.value,
      isDisabled: config.isDisabled,
      onChange: config.onChange,
      toView: (attributes) => {
        const select = h.select(
          [
            ...attributes.select,
            ...SelectLabel.match(config.label, {
              Visible: () => [],
              AriaOnly: ({ text }) => [h.AriaLabel(text)],
            }),
            ...config.extraAttributes,
            h.Class(config.className),
          ],
          config.options.map((option) =>
            h.keyed("option")(
              option.value,
              [h.Value(option.value), h.Selected(option.value === config.value)],
              [option.label],
            ),
          ),
        );
        return SelectLabel.match(config.label, {
          Visible: ({ text }) =>
            h.div(
              [h.Class("space-y-2")],
              [h.label([...attributes.label, h.Class(labelClassName)], [text]), select],
            ),
          AriaOnly: () => select,
        });
      },
    },
    h,
  );

const COMPACT_SELECT_CLASS = cn(
  nativeSelectClassNames.root,
  "h-8 py-1 pl-2 font-medium",
  nativeSelectClassNames.gutter,
);

export const compactSelectView = <Message>(
  config: SelectViewConfig<Message>,
  h: HtmlBuilder<Message>,
): Html =>
  nativeSelectView(
    {
      id: config.id,
      label: { _tag: "AriaOnly", text: config.ariaLabel },
      value: config.value,
      options: config.options,
      isDisabled: config.isDisabled,
      onChange: config.onChange,
      className: COMPACT_SELECT_CLASS,
      extraAttributes: [h.Title(config.title)],
    },
    h,
  );

const FIELD_SELECT_CLASS = {
  InRow: cn(
    nativeSelectClassNames.root,
    nativeSelectClassNames.height,
    "h-9 w-28 text-sm",
    nativeSelectClassNames.gutter,
  ),
  InForm: cn(
    nativeSelectClassNames.root,
    nativeSelectClassNames.height,
    "sm:w-36",
    nativeSelectClassNames.gutter,
  ),
} as const;

export type FieldSelectViewConfig<Message> = Readonly<{
  id: string;
  label: SelectLabel;
  value: string;
  options: ReadonlyArray<SelectOption>;
  isDisabled: boolean;
  onChange: (value: string) => Message;
  placement: keyof typeof FIELD_SELECT_CLASS;
}>;

export const fieldSelectView = <Message>(
  config: FieldSelectViewConfig<Message>,
  h: HtmlBuilder<Message>,
): Html =>
  nativeSelectView(
    {
      id: config.id,
      label: config.label,
      value: config.value,
      options: config.options,
      isDisabled: config.isDisabled,
      onChange: config.onChange,
      className: FIELD_SELECT_CLASS[config.placement],
      extraAttributes: [],
    },
    h,
  );
