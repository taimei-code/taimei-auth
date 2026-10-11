import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

export const LoadingRow = () => (
  <div className="flex justify-center py-12" role="status" aria-live="polite">
    <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
    <span className="sr-only">読み込み中…</span>
  </div>
);

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
