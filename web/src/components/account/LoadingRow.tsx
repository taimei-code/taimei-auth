import { Loader2 } from "lucide-react";

export const LoadingRow = ({ label = "読み込み中…" }: { label?: string }) => {
  return (
    <div className="flex justify-center py-12" role="status" aria-live="polite">
      <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  );
};
