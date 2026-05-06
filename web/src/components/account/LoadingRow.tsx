import { Loader2 } from "lucide-react";

// Sessions / Connections / その他 account 配下のリスト読み込み中スピナー。
// role="status" + aria-live + sr-only を 1 箇所に集約し、a11y 属性が個別実装で drift しないようにする。
export const LoadingRow = ({ label = "読み込み中…" }: { label?: string }) => {
  return (
    <div className="flex justify-center py-12" role="status" aria-live="polite">
      <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  );
};
