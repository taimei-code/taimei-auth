import { cn } from "@/lib/utils";

export type NoticeValue = { kind: "success" | "error"; text: string };

// mutation 結果の 1 行通知。kind → 色 / role の対応をここに閉じ、画面ごとに role の付き方が
// ばらつく (スクリーンリーダーに届いたり届かなかったり) のを防ぐ。error は role=alert
// (即時読み上げ)、success は role=status (現在の読み上げを妨げない)。
export const Notice = ({ value }: { value: NoticeValue | null }) => {
  if (!value) return null;
  return (
    <p
      role={value.kind === "error" ? "alert" : "status"}
      className={cn(
        "text-sm",
        value.kind === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {value.text}
    </p>
  );
};
