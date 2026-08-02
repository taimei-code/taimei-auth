import * as React from "react";

import { cn } from "@/lib/utils";

// DropdownMenu 依存を避けた native select の共通見た目。高さ (h-10)・文字サイズ
// (text-base md:text-sm)・枠線は Input に合わせ、フォームで横に並べたとき段差を出さない。
// @tailwindcss/forms が select の chevron を background (右端 0.5rem, 幅 1.5em) で描くため
// pr-8 で chevron 分の余白を確保する。利用側が px-* で padding-right を潰すと chevron が
// 文字に重なる (Members の役割 select で実測した崩れ)。左右は pl-* / pr-* で個別に上書きする。
// block は Label (inline) の直後でも独立行に積むために必要。
const NativeSelect = React.forwardRef<HTMLSelectElement, React.ComponentProps<"select">>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "block h-10 w-full rounded-md border border-input bg-transparent pl-3 pr-8 text-base text-foreground disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className,
      )}
      {...props}
    />
  ),
);
NativeSelect.displayName = "NativeSelect";

export { NativeSelect };
