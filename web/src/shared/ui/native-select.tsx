import * as React from "react";

import { cn } from "../utils";

// DropdownMenu に依存しない native select の共通の見た目。高さ、文字サイズ、枠線は Input に合わせ、
// 横に並べたときに段差を出さない。block は Label (inline) の直後でも独立した行に置くために必要である。
// @tailwindcss/forms が chevron を background (右端 0.5rem、幅 1.5em) で描くため、pr-8 で余白を確保する。
// 利用側が px-* で padding-right を上書きすると chevron が文字に重なる (Members の役割 select で実測)。
// truncate を付けるのは、native select が収まらない選択値を ellipsis なしで途中で切るため (CompanySwitcher で実測)。
// @tailwindcss/forms は py-2 も設定するため、h-* を h-10 より縮めるときは py-* も縮めて
// 「高さ − border − 縦 padding ≥ line-height」を保つ (破ると文字の下側が欠ける。h-8 だけを指定して実測)。
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
