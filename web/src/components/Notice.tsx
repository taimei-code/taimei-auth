import { AlertCircle, CheckCircle2 } from "lucide-react";

import { cn } from "@/lib/utils";

export type NoticeValue = { kind: "success" | "error"; text: string };

// 操作結果・取得エラーの通知ボックス。kind → 色 / role の対応をここに閉じ、画面ごとに
// role の付き方がばらつく (スクリーンリーダーに届いたり届かなかったり) のを防ぐ。error は
// role=alert (即時読み上げ)、success は role=status (現在の読み上げを妨げない)。
// success に緑は導入しない — palette に success 色の token を増やさず、可視性はアイコンと
// 面 (bg-secondary) で確保する。
export const Notice = ({ value }: { value: NoticeValue | null }) => {
  if (!value) return null;
  const isError = value.kind === "error";
  const Icon = isError ? AlertCircle : CheckCircle2;
  return (
    <p
      role={isError ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm",
        isError
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-border bg-secondary text-secondary-foreground",
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{value.text}</span>
    </p>
  );
};
