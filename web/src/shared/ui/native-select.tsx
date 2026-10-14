import * as React from "react";

import { cn } from "../utils";

const GUTTER_FOR_FORMS_PLUGIN_CHEVRON = "pr-8";
const HEIGHT_FITTING_FORMS_PLUGIN_PY_2 = "h-10";

const NativeSelect = React.forwardRef<HTMLSelectElement, React.ComponentProps<"select">>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "block w-full truncate rounded-md border border-input bg-transparent pl-3 text-base text-foreground disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        HEIGHT_FITTING_FORMS_PLUGIN_PY_2,
        className,
        GUTTER_FOR_FORMS_PLUGIN_CHEVRON,
      )}
      {...props}
    />
  ),
);
NativeSelect.displayName = "NativeSelect";

export { NativeSelect };
