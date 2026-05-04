import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// shadcn/ui 標準の cn helper: clsx で条件付きクラスを合成し
// tailwind-merge で同カテゴリの class 重複 (例: px-4 と px-6) を解決。
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
