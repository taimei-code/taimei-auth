import type { ReactNode } from "react";

import { LoadingRow } from "@/components/account/LoadingRow";

// mount 時に一覧を fetch するページの 4 分岐 (loading / error / 空 / 本体) の描画骨格。
// Sessions / Connections で分岐の形や role 付与がずれないよう 1 箇所に置く。
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
  if (errorMessage) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {errorMessage}
      </p>
    );
  }
  if (isEmpty) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  return <>{children}</>;
};
