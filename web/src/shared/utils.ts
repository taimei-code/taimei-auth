import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// UI primitive が共有する className 結合だけを担い、ドメイン判断は持たない。
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
