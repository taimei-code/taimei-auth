import { Fieldset, Input } from "@foldkit/ui";
import type { Html, HtmlBuilder } from "foldkit/html";

export type RadioOption<Value extends string> = Readonly<{ value: Value; label: string }>;

export type RadioFieldsetViewConfig<Value extends string, Message> = Readonly<{
  id: string;
  legend: string;
  name: string;
  options: ReadonlyArray<RadioOption<Value>>;
  selected: Value;
  onSelect: (value: Value) => Message;
  isDisabled: boolean;
}>;

const radioView = <Value extends string, Message>(
  config: RadioFieldsetViewConfig<Value, Message>,
  option: RadioOption<Value>,
  h: HtmlBuilder<Message>,
): Html =>
  Input.view(
    {
      id: `${config.id}-${option.value}`,
      type: "radio",
      name: config.name,
      value: option.value,
      isDisabled: config.isDisabled,
      toView: (attributes) =>
        h.label(
          [...attributes.label, h.Class("flex items-center gap-2 text-sm")],
          [
            h.input([
              ...attributes.input,
              h.Checked(option.value === config.selected),
              h.OnChange(() => config.onSelect(option.value)),
            ]),
            option.label,
          ],
        ),
    },
    h,
  );

export const radioFieldsetView = <Value extends string, Message>(
  config: RadioFieldsetViewConfig<Value, Message>,
  h: HtmlBuilder<Message>,
): Html =>
  Fieldset.view(
    {
      id: config.id,
      toView: (attributes) =>
        h.fieldset(
          [...attributes.fieldset, h.Class("space-y-2")],
          [
            h.legend([...attributes.legend, h.Class("text-sm font-medium")], [config.legend]),
            ...config.options.map((option) => radioView(config, option, h)),
          ],
        ),
    },
    h,
  );
