import { Select } from "@foldkit/ui";
import type { Html, HtmlBuilder } from "foldkit/html";

import { cn } from "../utils";
import { nativeSelectClassNames } from "./class-names";

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

const COMPACT_SELECT_CLASS = "h-8 py-1 pl-2 font-medium";

export const compactSelectView = <Message>(
  config: SelectViewConfig<Message>,
  h: HtmlBuilder<Message>,
): Html =>
  Select.view(
    {
      id: config.id,
      value: config.value,
      isDisabled: config.isDisabled,
      onChange: config.onChange,
      toView: (attributes) =>
        h.select(
          [
            ...attributes.select,
            h.AriaLabel(config.ariaLabel),
            h.Title(config.title),
            h.Class(
              cn(nativeSelectClassNames.root, COMPACT_SELECT_CLASS, nativeSelectClassNames.gutter),
            ),
          ],
          config.options.map((option) =>
            h.keyed("option")(
              option.value,
              [h.Value(option.value), h.Selected(option.value === config.value)],
              [option.label],
            ),
          ),
        ),
    },
    h,
  );
