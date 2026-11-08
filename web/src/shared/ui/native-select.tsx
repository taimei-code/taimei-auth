import * as React from "react";

import { cn } from "../utils";
import { nativeSelectClassNames } from "./class-names";

const NativeSelect = React.forwardRef<HTMLSelectElement, React.ComponentProps<"select">>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        nativeSelectClassNames.root,
        nativeSelectClassNames.height,
        className,
        nativeSelectClassNames.gutter,
      )}
      {...props}
    />
  ),
);
NativeSelect.displayName = "NativeSelect";

export { NativeSelect };
