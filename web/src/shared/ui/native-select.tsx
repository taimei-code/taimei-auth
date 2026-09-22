import * as React from "react";

import { cn } from "../utils";

// @tailwindcss/forms が chevron を右端の background で描くので pr-8 を px-* で上書きしない (文字に重なる)。同 plugin が py-2 を付けるので h-10 より縮めるなら py-* も縮める (高さ − border − 縦 padding < line-height だと文字が欠ける)
const NativeSelect = React.forwardRef<HTMLSelectElement, React.ComponentProps<"select">>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "block h-10 w-full truncate rounded-md border border-input bg-transparent pl-3 pr-8 text-base text-foreground disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className,
      )}
      {...props}
    />
  ),
);
NativeSelect.displayName = "NativeSelect";

export { NativeSelect };
