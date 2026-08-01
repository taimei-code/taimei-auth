import { Loader2 } from "lucide-react";

// 全画面ローディング。リスト内で使う LoadingRow と同じく role="status" + sr-only で
// スクリーンリーダーにも読み込み中を伝える。
export const FullScreenLoader = () => (
  <div className="flex min-h-svh items-center justify-center" role="status" aria-live="polite">
    <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
    <span className="sr-only">読み込み中…</span>
  </div>
);
