import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

const LoadingRow = () => (
  <div className="flex justify-center py-12" role="status" aria-live="polite">
    <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
    <span className="sr-only">読み込み中…</span>
  </div>
);

// 一覧 fetch ページの 4 分岐 (loading / error / 空 / 本体) の描画骨格。分岐の形や role 付与がずれないよう
// 1 箇所に置く。取得エラーは操作結果でないため toast に流さず inline (role=alert) に留める (shared/notify.tsx)。
export const AsyncSection = ({
  loading,
  errorMessage,
  isEmpty,
  emptyText,
  children,
}: {
  loading: boolean;
  errorMessage: string | null;
  isEmpty: boolean;
  emptyText: string;
  children: ReactNode;
}) => {
  if (loading) return <LoadingRow />;
  if (errorMessage)
    return (
      <p role="alert" className="text-sm text-destructive">
        {errorMessage}
      </p>
    );
  if (isEmpty) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  return <>{children}</>;
};
