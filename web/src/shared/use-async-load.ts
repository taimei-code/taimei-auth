import { useEffect, useState } from "react";

export function useAsyncLoad<T>(load: () => Promise<T>, errorFallback: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount 時に 1 回だけ実行する (load は render ごとに変わる inline 関数)
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
