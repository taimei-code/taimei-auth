// /rpc/* middleware の X-Service-Key 検証に使う有効 key 一覧を返す。
// A-2 (AWS Secrets Manager 統合) で本関数を差し替えて remote から取得する seam として置く。
export function getValidServiceKeys(): string[] {
  const active = process.env.AUTH_SERVICE_KEY;
  const previous = process.env.AUTH_SERVICE_KEY_PREVIOUS;
  return [active, previous].filter((k): k is string => !!k);
}
