import { useEffect, useState } from "react";

// mount 時に 1 回 fetch して loading / error / data の 3 状態で描画するページの domain-free な骨格。
// Sessions / Connections が同形の state + effect を各自で持ち、エラー処理だけずれるのを防ぐ。
export function useAsyncLoad<T>(load: () => Promise<T>, errorFallback: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount 時 1 回のみ実行する契約 (load は呼び出し側の inline 関数で毎 render 変わるため依存に入れない)
  useEffect(() => {
    load()
      .then(setData)
      .catch((error: unknown) => {
        setErrorMessage(error instanceof Error ? error.message : errorFallback);
      })
      .finally(() => setLoading(false));
  }, []);

  return { data, loading, errorMessage };
}
