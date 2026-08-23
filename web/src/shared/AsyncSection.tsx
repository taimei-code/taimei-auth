import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

const LoadingRow = () => (
  <div className="flex justify-center py-12" role="status" aria-live="polite">
    <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
    <span className="sr-only">読み込み中…</span>
  </div>
);

// mount 時に一覧を fetch するページの 4 分岐 (loading / error / 空 / 本体) の描画骨格。
// Sessions / Connections / Security で分岐の形や role 付与がずれないよう 1 箇所に置く。
// 取得エラーは操作結果ではないため toast (shared/notify.tsx の経路規則) に流さず、
// 画面に留まる inline 表示にする (role=alert で即時読み上げ)。
// 本体 (children) は呼び出し側が組む (リストの中身は画面固有のため)。
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
