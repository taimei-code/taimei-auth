import type { Html, HtmlBuilder } from "foldkit/html";
import { Upload } from "lucide";

import { Submission } from "../submission";
import { iconView, spinnerView } from "./icon-view";

export type FileInputViewConfig<Message> = Readonly<{
  id: string;
  label: string;
  submittingLabel: string;
  accept: string;
  describedBy: string;
  submission: Submission;
  onSelect: (files: ReadonlyArray<File>) => Message;
}>;

export const fileInputView = <Message>(
  config: FileInputViewConfig<Message>,
  h: HtmlBuilder<Message>,
): Html => {
  const isSubmitting = Submission.guards.Submitting(config.submission);
  return h.div(
    [],
    [
      h.label(
        [
          h.For(config.id),
          h.Class(
            "inline-flex cursor-pointer items-center gap-2 text-sm text-primary hover:underline [&_svg]:size-4",
          ),
        ],
        [
          isSubmitting ? spinnerView(h) : iconView(Upload, h),
          isSubmitting ? config.submittingLabel : config.label,
        ],
      ),
      h.input([
        h.Id(config.id),
        h.Type("file"),
        h.Accept(config.accept),
        h.Class("hidden"),
        h.Disabled(isSubmitting),
        h.AriaDescribedBy(config.describedBy),
        h.OnFileChange(config.onSelect),
      ]),
    ],
  );
};
